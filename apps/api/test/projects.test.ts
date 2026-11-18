import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, systemDb } from '../src/db/client';
import { memberships, users } from '../src/db/schema';
import { createTestApp, resetDb, signUp, type TestApp } from './helpers';

let t: TestApp;
beforeEach(async () => {
  await resetDb();
  t = await createTestApp();
});
afterAll(async () => {
  await t?.app.close();
  await closeDb();
});

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';
const call = (
  method: Method,
  url: string,
  cookie: string,
  payload?: object,
  headers: Record<string, string> = {},
) =>
  t.app.inject({ method, url, headers: { cookie, ...headers }, ...(payload ? { payload } : {}) });

interface Board {
  project: { id: string; name: string };
  columns: Array<{ id: string; name: string; position: string }>;
  cards: unknown[];
  labels: unknown[];
  members: Array<{ userId: string; name: string }>;
}

async function mkProject(u: { cookie: string; orgId: string }, name = 'P1') {
  const res = await call('POST', `/api/orgs/${u.orgId}/projects`, u.cookie, { name });
  expect(res.statusCode).toBe(201);
  return res.json<{ id: string; name: string }>();
}

describe('projects', () => {
  it('new project has columns Por hacer, En curso, Hecho in that order', async () => {
    const u = await signUp(t.app, { email: 'a@x.com', name: 'Ana' });
    const p = await mkProject(u);
    const res = await call('GET', `/api/orgs/${u.orgId}/projects/${p.id}/board`, u.cookie);
    expect(res.statusCode).toBe(200);
    const board = res.json<Board>();
    expect(board.columns.map((c) => c.name)).toEqual(['Por hacer', 'En curso', 'Hecho']);
    expect(board.project.name).toBe('P1');
    expect(board.cards).toEqual([]);
    expect(board.labels).toEqual([]);
    expect(board.members).toEqual([{ userId: u.userId, name: 'Ana' }]);
  });

  it('lists projects, renames and emits project.updated after commit', async () => {
    const u = await signUp(t.app, { email: 'a@x.com' });
    const p = await mkProject(u);
    const list = await call('GET', `/api/orgs/${u.orgId}/projects`, u.cookie);
    expect(list.json<Array<{ id: string }>>().map((x) => x.id)).toEqual([p.id]);
    const res = await call(
      'PATCH',
      `/api/orgs/${u.orgId}/projects/${p.id}`,
      u.cookie,
      { name: 'Nuevo' },
      { 'x-client-mutation-id': 'm-1' },
    );
    expect(res.statusCode).toBe(200);
    expect(res.json<{ name: string }>().name).toBe('Nuevo');
    expect(t.bus.boardEvents).toHaveLength(1);
    const ev = t.bus.boardEvents[0];
    expect(ev?.orgId).toBe(u.orgId);
    expect(ev?.projectId).toBe(p.id);
    expect(ev?.event).toMatchObject({
      type: 'project.updated',
      project: { id: p.id, name: 'Nuevo' },
      meta: { actorId: u.userId, clientMutationId: 'm-1' },
    });
  });

  it('rejects an empty name with 422 and a project of another org with 404', async () => {
    const a = await signUp(t.app, { email: 'a@x.com' });
    const b = await signUp(t.app, { email: 'b@x.com' });
    const empty = await call('POST', `/api/orgs/${a.orgId}/projects`, a.cookie, { name: ' ' });
    expect(empty.statusCode).toBe(422);
    const p = await mkProject(a);
    const board = (o: string, id: string, cookie: string) =>
      call('GET', `/api/orgs/${o}/projects/${id}/board`, cookie);
    expect((await board(b.orgId, p.id, b.cookie)).statusCode).toBe(404);
    expect((await board(a.orgId, p.id, b.cookie)).statusCode).toBe(404);
    expect((await board(a.orgId, 'not-a-uuid', a.cookie)).statusCode).toBe(404);
  });

  it('create and rename require admin: a member gets 403 and nothing changes', async () => {
    const a = await signUp(t.app, { email: 'a@x.com' });
    const m = await signUp(t.app, { email: 'm@x.com' });
    await systemDb
      .insert(memberships)
      .values({ organizationId: a.orgId, userId: m.userId, role: 'member' });
    const p = await mkProject(a, 'Original');
    const create = await call('POST', `/api/orgs/${a.orgId}/projects`, m.cookie, { name: 'X' });
    expect(create.statusCode).toBe(403);
    expect(create.json<{ error: { code: string } }>().error.code).toBe('forbidden');
    const rename = await call('PATCH', `/api/orgs/${a.orgId}/projects/${p.id}`, m.cookie, {
      name: 'Renamed by member',
    });
    expect(rename.statusCode).toBe(403);
    expect(t.bus.boardEvents).toEqual([]);
    const list = await call('GET', `/api/orgs/${a.orgId}/projects`, m.cookie);
    expect(list.json<Array<{ name: string }>>().map((x) => x.name)).toEqual(['Original']);
  });

  it('delete requires admin (member 403, demo 403) and emits project.deleted', async () => {
    const a = await signUp(t.app, { email: 'a@x.com' });
    const m = await signUp(t.app, { email: 'm@x.com' });
    await systemDb
      .insert(memberships)
      .values({ organizationId: a.orgId, userId: m.userId, role: 'member' });
    const p = await mkProject(a, 'By admin');
    const url = `/api/orgs/${a.orgId}/projects/${p.id}`;
    expect((await call('DELETE', url, m.cookie)).statusCode).toBe(403);
    await systemDb.update(users).set({ isDemo: true }).where(eq(users.id, a.userId));
    const demo = await call('DELETE', url, a.cookie);
    expect(demo.statusCode).toBe(403);
    expect(demo.json<{ error: { code: string } }>().error.code).toBe('demo_protected');
    await systemDb.update(users).set({ isDemo: false }).where(eq(users.id, a.userId));
    t.bus.boardEvents.length = 0;
    const del = await call('DELETE', url, a.cookie, undefined, { 'x-client-mutation-id': 'd1' });
    expect(del.statusCode).toBe(204);
    expect((await call('GET', `${url}/board`, a.cookie)).statusCode).toBe(404);
    expect(t.bus.boardEvents.map((e) => e.event)).toMatchObject([
      {
        type: 'project.deleted',
        projectId: p.id,
        meta: { actorId: a.userId, clientMutationId: 'd1' },
      },
    ]);
  });
});
