import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, systemDb } from '../src/db/client';
import { cards } from '../src/db/schema';
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

interface Col {
  id: string;
  name: string;
  position: string;
  projectId: string;
}
type U = { cookie: string; orgId: string; userId: string };

async function mkProject(u: U, name = 'P') {
  const p = (await call('POST', `/api/orgs/${u.orgId}/projects`, u.cookie, { name })).json<{
    id: string;
  }>();
  return { projectId: p.id, cols: await colsOf(u, p.id) };
}
async function setup() {
  const u = await signUp(t.app, { email: 'a@x.com' });
  return { u, ...(await mkProject(u)) };
}
const boardOf = (u: U, projectId: string) =>
  call('GET', `/api/orgs/${u.orgId}/projects/${projectId}/board`, u.cookie);
const colsOf = async (u: U, projectId: string) =>
  (await boardOf(u, projectId)).json<{ columns: Col[] }>().columns;
const names = (cs: Col[]) => cs.map((c) => c.name);
const colUrl = (u: U, id: string) => `/api/orgs/${u.orgId}/columns/${id}`;

async function addCards(u: U, projectId: string, columnId: string, titles: string[]) {
  for (const [i, title] of titles.entries()) {
    await systemDb.insert(cards).values({
      organizationId: u.orgId,
      projectId,
      columnId,
      title,
      position: `a${i}`,
      createdBy: u.userId,
    });
  }
}

describe('columns', () => {
  it('creates a column at the end and emits column.created with the mutation id', async () => {
    const { u, projectId } = await setup();
    t.bus.boardEvents.length = 0;
    const res = await call(
      'POST',
      `/api/orgs/${u.orgId}/projects/${projectId}/columns`,
      u.cookie,
      { name: 'QA' },
      { 'x-client-mutation-id': 'c-1' },
    );
    expect(res.statusCode).toBe(201);
    expect(names(await colsOf(u, projectId))).toEqual(['Por hacer', 'En curso', 'Hecho', 'QA']);
    expect(t.bus.boardEvents).toHaveLength(1);
    expect(t.bus.boardEvents[0]).toMatchObject({
      orgId: u.orgId,
      projectId,
      event: {
        type: 'column.created',
        column: { name: 'QA', projectId },
        meta: { actorId: u.userId, clientMutationId: 'c-1' },
      },
    });
  });

  it('ignores an oversized mutation id header', async () => {
    const { u, projectId } = await setup();
    t.bus.boardEvents.length = 0;
    await call(
      'POST',
      `/api/orgs/${u.orgId}/projects/${projectId}/columns`,
      u.cookie,
      { name: 'A' },
      { 'x-client-mutation-id': 'x'.repeat(65) },
    );
    expect(t.bus.boardEvents[0]?.event.meta).toEqual({ actorId: u.userId });
  });

  it('renames a column', async () => {
    const { u, cols } = await setup();
    const res = await call('PATCH', colUrl(u, cols[0]!.id), u.cookie, { name: 'Backlog' });
    expect(res.statusCode).toBe(200);
    expect(res.json<Col>()).toMatchObject({ name: 'Backlog', position: cols[0]!.position });
  });

  it('reorder column between two others updates only its position', async () => {
    const { u, projectId, cols } = await setup();
    const [a, b, c] = cols as [Col, Col, Col];
    t.bus.boardEvents.length = 0;
    const res = await call('PATCH', colUrl(u, c.id), u.cookie, { beforeId: a.id, afterId: b.id });
    expect(res.statusCode).toBe(200);
    const after = await colsOf(u, projectId);
    expect(names(after)).toEqual(['Por hacer', 'Hecho', 'En curso']);
    expect(after.find((x) => x.id === a.id)?.position).toBe(a.position);
    expect(after.find((x) => x.id === b.id)?.position).toBe(b.position);
    expect(t.bus.boardEvents[0]?.event).toMatchObject({
      type: 'column.updated',
      column: { id: c.id },
    });
  });

  it('ignores neighbours of another project (falls back to the end)', async () => {
    const { u, projectId, cols } = await setup();
    const other = await mkProject(u, 'P2');
    const res = await call('PATCH', colUrl(u, cols[0]!.id), u.cookie, {
      beforeId: other.cols[0]!.id,
      afterId: other.cols[1]!.id,
    });
    expect(res.statusCode).toBe(200);
    expect(names(await colsOf(u, projectId))).toEqual(['En curso', 'Hecho', 'Por hacer']);
  });

  it('non-adjacent before/after never duplicates a position', async () => {
    const { u, projectId, cols } = await setup();
    const [a, , c] = cols as [Col, Col, Col];
    await call('POST', `/api/orgs/${u.orgId}/projects/${projectId}/columns`, u.cookie, {
      name: 'Z',
    });
    const z = (await colsOf(u, projectId))[3]!;
    // Z claims to sit between a and c, but En curso is in between now.
    const res = await call('PATCH', colUrl(u, z.id), u.cookie, { beforeId: a.id, afterId: c.id });
    expect(res.statusCode).toBe(200);
    const after = await colsOf(u, projectId);
    expect(new Set(after.map((x) => x.position)).size).toBe(4);
    expect(names(after)).toEqual(['Por hacer', 'Z', 'En curso', 'Hecho']);
  });

  it('moves to the start when only afterId is given', async () => {
    const { u, projectId, cols } = await setup();
    await call('PATCH', colUrl(u, cols[2]!.id), u.cookie, { afterId: cols[0]!.id });
    expect(names(await colsOf(u, projectId))).toEqual(['Hecho', 'Por hacer', 'En curso']);
  });

  it('delete column with cards without moveTo → 409', async () => {
    const { u, projectId, cols } = await setup();
    await addCards(u, projectId, cols[0]!.id, ['x']);
    t.bus.boardEvents.length = 0;
    const res = await call('DELETE', colUrl(u, cols[0]!.id), u.cookie);
    expect(res.statusCode).toBe(409);
    expect(await colsOf(u, projectId)).toHaveLength(3);
    expect(t.bus.boardEvents).toHaveLength(0);
  });

  it('delete an empty column works without moveTo', async () => {
    const { u, projectId, cols } = await setup();
    const res = await call('DELETE', colUrl(u, cols[1]!.id), u.cookie);
    expect(res.statusCode).toBe(204);
    expect(names(await colsOf(u, projectId))).toEqual(['Por hacer', 'Hecho']);
  });

  it('delete column with moveTo moves cards to the end of target and emits column.deleted with movedCardIds', async () => {
    const { u, projectId, cols } = await setup();
    const [a, b] = cols as [Col, Col, Col];
    await addCards(u, projectId, a.id, ['a1', 'a2']);
    await addCards(u, projectId, b.id, ['b1']);
    t.bus.boardEvents.length = 0;
    const res = await call('DELETE', `${colUrl(u, a.id)}?moveTo=${b.id}`, u.cookie, undefined, {
      'x-client-mutation-id': 'del-1',
    });
    expect(res.statusCode).toBe(204);
    const board = (await boardOf(u, projectId)).json<{
      cards: Array<{ id: string; title: string; columnId: string; position: string }>;
    }>();
    const inB = board.cards
      .filter((c) => c.columnId === b.id)
      .sort((x, y) => (x.position < y.position ? -1 : 1));
    expect(inB.map((c) => c.title)).toEqual(['b1', 'a1', 'a2']);
    expect(t.bus.boardEvents).toHaveLength(1);
    expect(t.bus.boardEvents[0]?.event).toMatchObject({
      type: 'column.deleted',
      columnId: a.id,
      movedTo: b.id,
      meta: { actorId: u.userId, clientMutationId: 'del-1' },
    });
    const ev = t.bus.boardEvents[0]?.event as { movedCardIds: string[] };
    expect(ev.movedCardIds).toEqual(inB.slice(1).map((c) => c.id));
  });

  it('delete the only column → 409', async () => {
    const { u, projectId, cols } = await setup();
    await call('DELETE', colUrl(u, cols[0]!.id), u.cookie);
    await call('DELETE', colUrl(u, cols[1]!.id), u.cookie);
    const res = await call('DELETE', colUrl(u, cols[2]!.id), u.cookie);
    expect(res.statusCode).toBe(409);
    expect(await colsOf(u, projectId)).toHaveLength(1);
  });

  it('moveTo a column of another project → 404', async () => {
    const { u, projectId, cols } = await setup();
    const other = await mkProject(u, 'P2');
    await addCards(u, projectId, cols[0]!.id, ['x']);
    const res = await call(
      'DELETE',
      `${colUrl(u, cols[0]!.id)}?moveTo=${other.cols[0]!.id}`,
      u.cookie,
    );
    expect(res.statusCode).toBe(404);
    expect(await colsOf(u, projectId)).toHaveLength(3);
  });

  it('moveTo the column itself → 422', async () => {
    const { u, cols } = await setup();
    const res = await call('DELETE', `${colUrl(u, cols[0]!.id)}?moveTo=${cols[0]!.id}`, u.cookie);
    expect(res.statusCode).toBe(422);
  });

  it('a column of another org → 404', async () => {
    const { cols } = await setup();
    const b = await signUp(t.app, { email: 'b@x.com' });
    const patch = await call('PATCH', colUrl(b, cols[0]!.id), b.cookie, { name: 'x' });
    expect(patch.statusCode).toBe(404);
    expect((await call('DELETE', colUrl(b, cols[0]!.id), b.cookie)).statusCode).toBe(404);
  });
});
