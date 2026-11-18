import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseMentionIds } from '@kanban/shared';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { closeDb, systemDb } from '../src/db/client';
import {
  cards,
  comments,
  demoState,
  mailbox,
  memberships,
  notifications,
  organizations,
  sessions,
  users,
} from '../src/db/schema';
import { withUserTx } from '../src/db/tx';
import { enqueueEmail } from '../src/modules/mail/queue';
import { NullTransport } from '../src/modules/mail/transport';
import { seedIfEmpty } from '../src/modules/demo/seed-if-empty';
import { resetDemo } from '../src/modules/demo/service';
import { seedDemo } from '../src/modules/demo/seed';
import { createTestApp, RecordingBus, resetDb, signUp, type TestApp } from './helpers';

const extra: Array<{ app: { close(): Promise<unknown> } }> = [];
afterAll(async () => {
  for (const e of extra) await e.app.close();
  await closeDb();
});
beforeEach(resetDb);

async function demoApp(overrides: Record<string, string> = { DEMO_MODE: 'true' }) {
  const t = await createTestApp(overrides);
  extra.push(t);
  return t;
}

const demoLogin = (t: TestApp, email: string) =>
  t.app.inject({ method: 'POST', url: '/api/auth/demo-login', payload: { email } });

describe('seed', () => {
  it('creates 2 demo orgs and 4 demo users, all flagged is_demo and without password', async () => {
    await seedDemo();
    const orgs = await systemDb.select().from(organizations);
    expect(orgs.map((o) => o.name).sort()).toEqual(['Estudio Acme', 'Otra Empresa']);
    expect(orgs.every((o) => o.isDemo)).toBe(true);
    const us = await systemDb.select().from(users);
    expect(us.map((u) => u.email).sort()).toEqual([
      'ana@demo.local',
      'luis@demo.local',
      'marta@demo.local',
      'pablo@demo.local',
    ]);
    expect(us.every((u) => u.isDemo && u.passwordHash === null)).toBe(true);
    const ana = us.find((u) => u.email === 'ana@demo.local');
    const [m] = await systemDb.select().from(memberships).where(eq(memberships.userId, ana!.id));
    expect(m?.role).toBe('admin');
  });

  it('seeds cards, comments with valid mention tokens and notifications', async () => {
    await seedDemo();
    expect(await systemDb.select().from(cards)).toHaveLength(18);
    const cs = await systemDb.select().from(comments);
    expect(cs).toHaveLength(4);
    const userIds = new Set((await systemDb.select().from(users)).map((u) => u.id));
    for (const c of cs) {
      const ids = parseMentionIds(c.body);
      expect(ids.length).toBeGreaterThan(0);
      for (const id of ids) expect(userIds.has(id)).toBe(true);
    }
    expect((await systemDb.select().from(notifications)).length).toBeGreaterThanOrEqual(3);
  });
});

describe('demo-login', () => {
  it('is 404 when DEMO_MODE=false', async () => {
    await seedDemo();
    const t = await demoApp({ DEMO_MODE: 'false' });
    expect((await demoLogin(t, 'ana@demo.local')).statusCode).toBe(404);
    expect((await t.app.inject({ method: 'GET', url: '/api/demo/users' })).statusCode).toBe(404);
  });

  it('is 404 for a non-demo user and for an unknown email', async () => {
    const t = await demoApp();
    await signUp(t.app, { email: 'real@example.com' });
    expect((await demoLogin(t, 'real@example.com')).statusCode).toBe(404);
    expect((await demoLogin(t, 'nadie@demo.local')).statusCode).toBe(404);
  });

  it('opens a normal session for a demo user', async () => {
    await seedDemo();
    const t = await demoApp();
    const res = await demoLogin(t, 'ana@demo.local');
    expect(res.statusCode).toBe(200);
    expect(res.json().user).toMatchObject({ email: 'ana@demo.local', isDemo: true });
    expect(res.json().memberships[0]).toMatchObject({ orgName: 'Estudio Acme', role: 'admin' });
    const cookie = String(res.headers['set-cookie']).split(';')[0]!;
    const me = await t.app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    expect(me.statusCode).toBe(200);
  });

  it('is rate limited like login', async () => {
    await seedDemo();
    const t = await demoApp({ DEMO_MODE: 'true', AUTH_RATE_LIMIT_MAX: '2' });
    expect((await demoLogin(t, 'ana@demo.local')).statusCode).toBe(200);
    expect((await demoLogin(t, 'ana@demo.local')).statusCode).toBe(200);
    expect((await demoLogin(t, 'ana@demo.local')).statusCode).toBe(429);
  });

  it('lists the demo users with their organisation', async () => {
    await seedDemo();
    const t = await demoApp();
    const res = await t.app.inject({ method: 'GET', url: '/api/demo/users' });
    expect(res.statusCode).toBe(200);
    const list = res.json<Array<{ email: string; name: string; orgName: string }>>();
    expect(list.map((u) => u.name)).toEqual([
      'Ana López',
      'Luis García',
      'Marta Ruiz',
      'Pablo Sanz',
    ]);
    expect(list[0]).toEqual({
      email: 'ana@demo.local',
      name: 'Ana López',
      orgName: 'Estudio Acme',
    });
    expect(list[3]?.orgName).toBe('Otra Empresa');
  });

  it('returns an empty list when nothing is seeded', async () => {
    const t = await demoApp();
    const res = await t.app.inject({ method: 'GET', url: '/api/demo/users' });
    expect(res.json()).toEqual([]);
  });
});

describe('resetDemo', () => {
  it('removes a registered non-demo user, sessions and mail, reseeds and broadcasts demo:reset', async () => {
    const t = await demoApp();
    const visitor = await signUp(t.app, {
      email: 'visitor@example.com',
      orgName: 'Visitante SL',
    });
    await withUserTx(visitor.userId, (ctx) =>
      enqueueEmail(ctx, {
        kind: 'invitation',
        toEmail: 'x@example.com',
        actorId: visitor.userId,
        payload: { orgName: 'Visitante SL', link: 'http://x/invitacion/t', inviterName: 'V' },
      }),
    );
    await systemDb
      .insert(mailbox)
      .values({ toEmail: 'visitor@example.com', subject: 's', html: 'h', text: 't' });
    const bus = new RecordingBus();
    await resetDemo(bus);

    const us = await systemDb.select().from(users);
    expect(us).toHaveLength(4);
    expect(us.some((u) => u.email === 'visitor@example.com')).toBe(false);
    expect(await systemDb.select().from(sessions)).toHaveLength(0);
    expect(await systemDb.select().from(mailbox)).toHaveLength(0);
    const jobs = await systemDb.execute<{ n: number }>(
      sql`select count(*)::int as n from pgboss.job`,
    );
    expect(jobs.rows[0]?.n).toBe(0);
    expect(await systemDb.select().from(organizations)).toHaveLength(2);
    expect(bus.broadcasts).toEqual(['demo:reset']);
    const [state] = await systemDb.select().from(demoState);
    expect(state?.lastResetAt).toBeInstanceOf(Date);
    expect(Date.now() - state!.lastResetAt!.getTime()).toBeLessThan(60_000);
  });

  it('is repeatable: same content after a second reset', async () => {
    const bus = new RecordingBus();
    await resetDemo(bus);
    await resetDemo(bus);
    expect(await systemDb.select().from(cards)).toHaveLength(18);
    expect(await systemDb.select().from(organizations)).toHaveLength(2);
    const res = await systemDb.execute<{ n: number }>(sql`select count(*)::int as n from users`);
    expect(res.rows[0]?.n).toBe(4);
  });
});

describe('seedIfEmpty', () => {
  it('seeds an empty database only in DEMO_MODE and never touches existing data', async () => {
    expect(await seedIfEmpty({ demoMode: false })).toBe(false);
    expect(await systemDb.select().from(organizations)).toHaveLength(0);
    expect(await seedIfEmpty({ demoMode: true })).toBe(true);
    expect(await systemDb.select().from(organizations)).toHaveLength(2);
    expect(await seedIfEmpty({ demoMode: true })).toBe(false);
  });
});

describe('serving the web build', () => {
  const root = mkdtempSync(join(tmpdir(), 'kanban-web-'));
  mkdirSync(join(root, 'assets'));
  writeFileSync(join(root, 'index.html'), '<!doctype html><title>SPA</title>');
  writeFileSync(join(root, 'assets', 'app.js'), 'console.log(1)');
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  async function webApp() {
    const config = loadConfig({ ...process.env, WEB_DIST_DIR: root });
    const app = await buildApp({
      config,
      bus: new RecordingBus(),
      mail: new NullTransport(),
      logger: false,
    });
    await app.ready();
    extra.push({ app });
    return app;
  }

  it('serves index.html at / and for client-side routes that accept HTML', async () => {
    const app = await webApp();
    const html = { accept: 'text/html' };
    for (const url of ['/', '/entrar', '/o/123/p/456']) {
      const res = await app.inject({ method: 'GET', url, headers: html });
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('<title>SPA</title>');
    }
    const asset = await app.inject({ method: 'GET', url: '/assets/app.js' });
    expect(asset.statusCode).toBe(200);
    expect(asset.headers['cache-control']).toContain('immutable');
    const index = await app.inject({ method: 'GET', url: '/', headers: html });
    expect(index.headers['cache-control']).toBe('no-cache');
  });

  it('keeps unknown /api and /internal paths as JSON 404', async () => {
    const app = await webApp();
    for (const url of ['/api/nope', '/internal/nope']) {
      const res = await app.inject({ method: 'GET', url, headers: { accept: 'text/html' } });
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe('not_found');
    }
    expect((await app.inject({ method: 'GET', url: '/api/health' })).json()).toEqual({ ok: true });
  });

  it('does not serve the SPA when the directory does not exist', async () => {
    const t = await demoApp({ DEMO_MODE: 'true', WEB_DIST_DIR: join(root, 'missing') });
    const res = await t.app.inject({ method: 'GET', url: '/', headers: { accept: 'text/html' } });
    expect(res.statusCode).toBe(404);
  });
});
