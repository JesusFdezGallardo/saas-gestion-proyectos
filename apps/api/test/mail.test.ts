import type { NotificationDto } from '@kanban/shared';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeDb, systemDb } from '../src/db/client';
import { emailBlocklist, mailbox, memberships, userSettings, users } from '../src/db/schema';
import { withUserTx } from '../src/db/tx';
import { enqueueEmail, type EmailJobData } from '../src/modules/mail/queue';
import { QUOTA_LIMITS, tryConsume, utcDay } from '../src/modules/mail/quota';
import { unsubscribeToken } from '../src/modules/mail/templates';
import { RecordingTransport, type MailTransport } from '../src/modules/mail/transport';
import {
  drainEmailQueue,
  handleEmailJob,
  type EmailJob,
  type WorkerDeps,
} from '../src/modules/mail/worker';
import { createTestApp, resetDb, signUp, type TestApp } from './helpers';

let t: TestApp;
beforeEach(async () => {
  vi.restoreAllMocks();
  await resetDb();
  t = await createTestApp();
});
afterAll(async () => {
  await t?.app.close();
  await closeDb();
});

const deps = (transport: MailTransport = new RecordingTransport()): WorkerDeps => ({
  transport,
  deliver: true,
  appOrigin: t.app.config.appOrigin,
  unsubscribeSecret: t.app.config.unsubscribeSecret,
  log: { error: () => undefined, warn: () => undefined },
});

let seq = 0;
const job = (data: EmailJobData, retryCount = 0): EmailJob => ({
  id: `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`,
  data,
  retryCount,
  retryLimit: 2,
});

const notif = (over: Partial<NotificationDto> = {}): NotificationDto => ({
  id: '11111111-1111-4111-8111-111111111111',
  type: 'mention',
  orgId: '22222222-2222-4222-8222-222222222222',
  projectId: '33333333-3333-4333-8333-333333333333',
  cardId: '44444444-4444-4444-8444-444444444444',
  cardTitle: 'Diseñar <logo>',
  actorId: '55555555-5555-4555-8555-555555555555',
  actorName: 'Ana',
  commentId: null,
  readAt: null,
  createdAt: new Date().toISOString(),
  ...over,
});

async function user(email: string, opts: { isDemo?: boolean; name?: string } = {}) {
  const [u] = await systemDb
    .insert(users)
    .values({ email, name: opts.name ?? email.split('@')[0]!, isDemo: opts.isDemo ?? false })
    .returning({ id: users.id });
  return u!.id;
}

const notificationJob = (toEmail: string, actorId: string): EmailJobData => ({
  kind: 'notification',
  toEmail,
  actorId,
  payload: notif({ actorId }),
});

const mailRows = (email?: string) =>
  email
    ? systemDb.select().from(mailbox).where(eq(mailbox.toEmail, email))
    : systemDb.select().from(mailbox);

const queuedJobs = async () =>
  (
    await systemDb.execute<{ n: number }>(
      sql`select count(*)::int as n from pgboss.job where name = 'email'`,
    )
  ).rows[0]?.n ?? 0;

describe('email worker', () => {
  it('notification email is stored in mailbox and sent for a real user', async () => {
    await user('luis@x.com');
    const actor = await user('ana@x.com', { name: 'Ana' });
    const tr = new RecordingTransport();
    const status = await handleEmailJob(job(notificationJob('luis@x.com', actor)), deps(tr));
    expect(status).toBe('sent');
    const [row] = await mailRows('luis@x.com');
    expect(row?.status).toBe('sent');
    expect(row?.subject).toBe('Ana te ha mencionado en «Diseñar <logo>»');
    // user text is escaped in the HTML part, raw in the text part
    expect(row?.html).toContain('Diseñar &lt;logo&gt;');
    expect(row?.html).not.toContain('<logo>');
    expect(row?.text).toContain('Diseñar <logo>');
    const n = notif();
    expect(row?.text).toContain(
      `${t.app.config.appOrigin}/o/${n.orgId}/p/${n.projectId}?card=${n.cardId}`,
    );
    expect(row?.text).toContain('Recibes esto porque te registraste o te invitaron');
    expect(row?.html).toContain('/api/mail/unsubscribe?e=luis%40x.com&amp;t=');
    expect(tr.sent).toHaveLength(1);
    expect(tr.sent[0]).toMatchObject({ to: 'luis@x.com', subject: row?.subject });
    expect(tr.sent[0]?.unsubscribeUrl).toMatch(/\/api\/mail\/unsubscribe\?e=luis%40x\.com&t=/);
  });

  it('demo recipient → mailbox only, status skipped_demo, transport not called', async () => {
    await user('luis@demo.local', { isDemo: true });
    const actor = await user('ana@x.com');
    const tr = new RecordingTransport();
    await handleEmailJob(job(notificationJob('luis@demo.local', actor)), deps(tr));
    expect((await mailRows())[0]?.status).toBe('skipped_demo');
    expect(tr.sent).toHaveLength(0);
  });

  it('real recipient but demo actor → skipped_demo', async () => {
    await user('luis@x.com');
    const actor = await user('ana@demo.local', { isDemo: true });
    const tr = new RecordingTransport();
    await handleEmailJob(job(notificationJob('luis@x.com', actor)), deps(tr));
    expect((await mailRows())[0]?.status).toBe('skipped_demo');
    expect(tr.sent).toHaveLength(0);
  });

  it('blocklisted address → skipped_blocked', async () => {
    const actor = await user('ana@x.com');
    await systemDb.insert(emailBlocklist).values({ email: 'nadie@x.com' });
    const tr = new RecordingTransport();
    const data: EmailJobData = {
      kind: 'invitation',
      toEmail: 'Nadie@X.com',
      actorId: actor,
      payload: { orgName: 'Acme', link: 'http://x/invitacion/abc', inviterName: 'Ana' },
    };
    await handleEmailJob(job(data), deps(tr));
    expect((await mailRows())[0]?.status).toBe('skipped_blocked');
    expect(tr.sent).toHaveLength(0);
  });

  it('MAIL_TRANSPORT=none → mailbox only, status stored, no quota used', async () => {
    await user('luis@x.com');
    const actor = await user('ana@x.com');
    const tr = new RecordingTransport();
    await handleEmailJob(job(notificationJob('luis@x.com', actor)), {
      ...deps(tr),
      deliver: false,
    });
    expect((await mailRows())[0]?.status).toBe('stored');
    expect(tr.sent).toHaveLength(0);
    const q = await systemDb.execute(sql`select * from email_quota`);
    expect(q.rows).toHaveLength(0);
  });

  it('11th real email to the same address in a day → skipped_limit', async () => {
    await user('luis@x.com');
    const actor = await user('ana@x.com');
    const tr = new RecordingTransport();
    const statuses: Array<string | null> = [];
    for (let i = 0; i < 11; i++) {
      statuses.push(await handleEmailJob(job(notificationJob('luis@x.com', actor)), deps(tr)));
    }
    expect(statuses.slice(0, 10)).toEqual(Array(10).fill('sent'));
    expect(statuses[10]).toBe('skipped_limit');
    expect(tr.sent).toHaveLength(10);
    expect(await mailRows('luis@x.com')).toHaveLength(11);
  });

  it('11th invitation by the same user in a day → skipped_limit', async () => {
    const actor = await user('ana@x.com');
    const tr = new RecordingTransport();
    const statuses: Array<string | null> = [];
    for (let i = 0; i < 11; i++) {
      const data: EmailJobData = {
        kind: 'invitation',
        toEmail: `invitado${i}@x.com`, // different addresses: only the inviter limit applies
        actorId: actor,
        payload: { orgName: 'Estudio Acme', link: 'http://x/invitacion/abc', inviterName: 'Ana' },
      };
      statuses.push(await handleEmailJob(job(data), deps(tr)));
    }
    expect(statuses.slice(0, 10)).toEqual(Array(10).fill('sent'));
    expect(statuses[10]).toBe('skipped_limit');
    expect(tr.sent[0]?.subject).toBe('Te han invitado a Estudio Acme');
  });

  it('a retried job reuses its mailbox row and does not consume quota twice', async () => {
    await user('luis@x.com');
    const actor = await user('ana@x.com');
    let calls = 0;
    const flaky: MailTransport = {
      send: () => (++calls === 1 ? Promise.reject(new Error('smtp down')) : Promise.resolve()),
    };
    const j = job(notificationJob('luis@x.com', actor));
    await expect(handleEmailJob(j, deps(flaky))).rejects.toThrow('smtp down');
    expect((await mailRows())[0]?.status).toBe('stored');
    expect(await handleEmailJob({ ...j, retryCount: 1 }, deps(flaky))).toBe('sent');
    expect(await mailRows()).toHaveLength(1);
    const q = await systemDb.execute<{ count: number }>(
      sql`select count from email_quota where scope = 'recipient'`,
    );
    expect(q.rows[0]?.count).toBe(1);
  });

  it('transport failure 3 times → status failed', async () => {
    await user('luis@x.com');
    const actor = await user('ana@x.com');
    const failing: MailTransport = { send: () => Promise.reject(new Error('smtp down')) };
    const j = job(notificationJob('luis@x.com', actor));
    for (let attempt = 0; attempt < 3; attempt++) {
      await expect(handleEmailJob({ ...j, retryCount: attempt }, deps(failing))).rejects.toThrow(
        'smtp down',
      );
      const [row] = await mailRows();
      expect(row?.status).toBe(attempt < 2 ? 'stored' : 'failed');
    }
    expect(await mailRows()).toHaveLength(1);
  });

  it('user with emailNotifications=false gets no mailbox entry and no send', async () => {
    const luis = await user('luis@x.com');
    const actor = await user('ana@x.com');
    await systemDb.insert(userSettings).values({ userId: luis, emailNotifications: false });
    const tr = new RecordingTransport();
    expect(await handleEmailJob(job(notificationJob('luis@x.com', actor)), deps(tr))).toBeNull();
    expect(await mailRows()).toHaveLength(0);
    expect(tr.sent).toHaveLength(0);
  });

  it('invitations ignore emailNotifications=false', async () => {
    const luis = await user('luis@x.com');
    const actor = await user('ana@x.com');
    await systemDb.insert(userSettings).values({ userId: luis, emailNotifications: false });
    const tr = new RecordingTransport();
    const data: EmailJobData = {
      kind: 'invitation',
      toEmail: 'luis@x.com',
      actorId: actor,
      payload: { orgName: 'Acme', link: 'http://x/invitacion/abc', inviterName: 'Ana' },
    };
    expect(await handleEmailJob(job(data), deps(tr))).toBe('sent');
  });
});

describe('quota', () => {
  it('20 concurrent consumes with limit 10 grant exactly 10', async () => {
    const day = utcDay();
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        tryConsume(day, [
          { scope: 'global', key: 'all', limit: 250 },
          { scope: 'recipient', key: 'luis@x.com', limit: 10 },
        ]),
      ),
    );
    expect(results.filter(Boolean)).toHaveLength(10);
    const rows = await systemDb.execute<{ scope: string; count: number }>(
      sql`select scope, count from email_quota order by scope`,
    );
    // all-or-nothing: the global counter only counts the 10 granted ones
    expect(rows.rows).toEqual([
      { scope: 'recipient', count: 10 },
      { scope: 'global', count: 10 },
    ]);
  });

  it('limits are the documented ones', () => {
    expect(QUOTA_LIMITS).toEqual({ global: 250, recipient: 10, inviter: 10 });
  });
});

describe('queue', () => {
  it('rolled-back transaction enqueues no job', async () => {
    const u = await user('ana@x.com');
    await expect(
      withUserTx(u, async (ctx) => {
        await enqueueEmail(ctx, notificationJob('luis@x.com', u));
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await queuedJobs()).toBe(0);
    await withUserTx(u, (ctx) => enqueueEmail(ctx, notificationJob('luis@x.com', u)));
    expect(await queuedJobs()).toBe(1);
  });

  it('app_user can enqueue but not read jobs nor write mail tables', async () => {
    const u = await user('ana@x.com');
    const denied = async (q: ReturnType<typeof sql>) => {
      const err = await withUserTx(u, ({ tx }) => tx.execute(q)).catch((e: unknown) => e);
      expect(String((err as { cause?: unknown }).cause ?? err)).toMatch(/permission denied/);
    };
    await denied(sql`select data from pgboss.job_common`);
    await denied(sql`delete from pgboss.job_common`);
    await denied(
      sql`insert into mailbox (to_email, subject, html, text) values ('x@x.com','s','h','t')`,
    );
    await denied(sql`select * from email_quota`);
    await denied(sql`insert into email_blocklist (email) values ('x@x.com')`);
  });

  it('a mention through the API is enqueued and, drained, lands in the mailbox and is sent', async () => {
    const ana = await signUp(t.app, { email: 'a@x.com', name: 'Ana' });
    const luis = await signUp(t.app, { email: 'l@x.com', name: 'Luis', orgName: 'L' });
    await systemDb
      .insert(memberships)
      .values({ organizationId: ana.orgId, userId: luis.userId, role: 'member' });
    const call = (method: 'GET' | 'POST', url: string, cookie: string, payload?: object) =>
      t.app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });
    const p = (
      await call('POST', `/api/orgs/${ana.orgId}/projects`, ana.cookie, { name: 'P' })
    ).json<{ id: string }>();
    const board = (
      await call('GET', `/api/orgs/${ana.orgId}/projects/${p.id}/board`, ana.cookie)
    ).json<{ columns: Array<{ id: string }> }>();
    const card = (
      await call(
        'POST',
        `/api/orgs/${ana.orgId}/columns/${board.columns[0]!.id}/cards`,
        ana.cookie,
        {
          title: 'Diseñar logo',
        },
      )
    ).json<{ id: string }>();
    const res = await call('POST', `/api/orgs/${ana.orgId}/cards/${card.id}/comments`, ana.cookie, {
      body: `mira esto @[Luis](user:${luis.userId})`,
    });
    expect(res.statusCode).toBe(201);
    expect(await queuedJobs()).toBe(1);

    const tr = new RecordingTransport();
    expect(await drainEmailQueue(deps(tr))).toBe(1);
    expect(tr.sent).toEqual([
      expect.objectContaining({ to: 'l@x.com', subject: 'Ana te ha mencionado en «Diseñar logo»' }),
    ]);
    const box = (await call('GET', '/api/mailbox', luis.cookie)).json<
      Array<{ subject: string; status: string }>
    >();
    expect(box).toEqual([
      expect.objectContaining({
        subject: 'Ana te ha mencionado en «Diseñar logo»',
        status: 'sent',
      }),
    ]);
    // Ana does not see Luis's email
    expect((await call('GET', '/api/mailbox', ana.cookie)).json()).toEqual([]);
  });

  it('invited address sees invitation in /api/mailbox after registering', async () => {
    const ana = await signUp(t.app, { email: 'a@x.com', name: 'Ana', orgName: 'Estudio Acme' });
    const inv = await t.app.inject({
      method: 'POST',
      url: `/api/orgs/${ana.orgId}/invitations`,
      headers: { cookie: ana.cookie },
      payload: { email: 'nuevo@x.com' },
    });
    expect(inv.statusCode).toBe(201);
    const { link } = inv.json<{ link: string }>();
    const tr = new RecordingTransport();
    expect(await drainEmailQueue(deps(tr))).toBe(1);

    const nuevo = await signUp(t.app, { email: 'Nuevo@X.com', name: 'Nuevo', orgName: 'N' });
    const res = await t.app.inject({
      method: 'GET',
      url: '/api/mailbox',
      headers: { cookie: nuevo.cookie },
    });
    expect(res.statusCode).toBe(200);
    const box = res.json<Array<Record<string, string>>>();
    expect(box).toHaveLength(1);
    expect(box[0]).toMatchObject({ subject: 'Te han invitado a Estudio Acme', status: 'sent' });
    expect(Object.keys(box[0]!).sort()).toEqual(
      ['createdAt', 'html', 'id', 'status', 'subject', 'text'].sort(),
    );
    expect(box[0]!.text).toContain(link);
  });

  it('GET /api/mailbox needs a session', async () => {
    expect((await t.app.inject({ method: 'GET', url: '/api/mailbox' })).statusCode).toBe(401);
  });
});

describe('unsubscribe', () => {
  const url = (e: string, tok: string) =>
    `/api/mail/unsubscribe?e=${encodeURIComponent(e)}&t=${encodeURIComponent(tok)}`;

  it('unsubscribe with bad hmac → 400; good hmac disables emails', async () => {
    const luis = await user('luis@x.com');
    const bad = await t.app.inject({ method: 'GET', url: url('luis@x.com', 'nope') });
    expect(bad.statusCode).toBe(400);
    const other = unsubscribeToken('otro@x.com', t.app.config.unsubscribeSecret);
    expect((await t.app.inject({ method: 'GET', url: url('luis@x.com', other) })).statusCode).toBe(
      400,
    );

    const tok = unsubscribeToken('luis@x.com', t.app.config.unsubscribeSecret);
    for (let i = 0; i < 2; i++) {
      // idempotent
      const ok = await t.app.inject({ method: 'GET', url: url('LUIS@x.com', tok) });
      expect(ok.statusCode).toBe(200);
      expect(ok.headers['content-type']).toMatch(/text\/html/);
      expect(ok.body).toContain('No recibirás más correos');
    }
    const [s] = await systemDb.select().from(userSettings).where(eq(userSettings.userId, luis));
    expect(s?.emailNotifications).toBe(false);
    expect(await systemDb.select().from(emailBlocklist)).toHaveLength(0);
  });

  it('an address without account is blocklisted', async () => {
    const tok = unsubscribeToken('nadie@x.com', t.app.config.unsubscribeSecret);
    const ok = await t.app.inject({ method: 'GET', url: url('nadie@x.com', tok) });
    expect(ok.statusCode).toBe(200);
    expect((await t.app.inject({ method: 'GET', url: url('nadie@x.com', tok) })).statusCode).toBe(
      200,
    );
    const rows = await systemDb.select().from(emailBlocklist);
    expect(rows.map((r) => r.email)).toEqual(['nadie@x.com']);
  });
});
