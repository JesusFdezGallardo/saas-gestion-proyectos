import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, systemDb } from '../src/db/client';
import { memberships } from '../src/db/schema';
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
const call = (method: Method, url: string, cookie: string, payload?: object) =>
  t.app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });

interface Card {
  id: string;
  projectId: string;
  columnId: string;
  title: string;
  description: string;
  assigneeId: string | null;
  dueDate: string | null;
  position: string;
  labelIds: string[];
  createdBy: string;
  commentCount: number;
}
type U = { cookie: string; orgId: string; userId: string };

async function mkProject(u: U) {
  const p = (await call('POST', `/api/orgs/${u.orgId}/projects`, u.cookie, { name: 'P' })).json<{
    id: string;
  }>();
  const board = (await call('GET', `/api/orgs/${u.orgId}/projects/${p.id}/board`, u.cookie)).json<{
    columns: Array<{ id: string }>;
  }>();
  return { projectId: p.id, cols: board.columns.map((c) => c.id) };
}
async function setup() {
  const u = await signUp(t.app, { email: 'a@x.com' });
  return { u, ...(await mkProject(u)) };
}
const mkCard = async (u: U, columnId: string, title: string, extra: object = {}) => {
  const res = await call('POST', `/api/orgs/${u.orgId}/columns/${columnId}/cards`, u.cookie, {
    title,
    ...extra,
  });
  expect(res.statusCode).toBe(201);
  return res.json<Card>();
};
const move = (u: U, cardId: string, body: object) =>
  call('POST', `/api/orgs/${u.orgId}/cards/${cardId}/move`, u.cookie, body);
const boardCards = async (u: U, projectId: string) =>
  (await call('GET', `/api/orgs/${u.orgId}/projects/${projectId}/board`, u.cookie)).json<{
    cards: Card[];
  }>().cards;
const idsIn = (cards: Card[], columnId: string) =>
  cards.filter((c) => c.columnId === columnId).map((c) => c.id);
const mkLabel = async (u: U, projectId: string, name = 'L') =>
  (
    await call('POST', `/api/orgs/${u.orgId}/projects/${projectId}/labels`, u.cookie, {
      name,
      color: '#ef4444',
    })
  ).json<{ id: string }>();

describe('cards', () => {
  it('create, update, delete card emit card.created/updated/deleted', async () => {
    const { u, projectId, cols } = await setup();
    t.bus.boardEvents.length = 0;
    const res = await call('POST', `/api/orgs/${u.orgId}/columns/${cols[0]}/cards`, u.cookie, {
      title: '  Primera ',
      description: 'desc',
      dueDate: '2026-12-31',
    });
    expect(res.statusCode).toBe(201);
    const card = res.json<Card>();
    expect(card).toMatchObject({
      projectId,
      columnId: cols[0],
      title: 'Primera',
      description: 'desc',
      assigneeId: null,
      dueDate: '2026-12-31',
      labelIds: [],
      createdBy: u.userId,
      commentCount: 0,
    });

    const upd = await call('PATCH', `/api/orgs/${u.orgId}/cards/${card.id}`, u.cookie, {
      title: 'Cambiada',
      dueDate: null,
      assigneeId: u.userId,
    });
    expect(upd.statusCode).toBe(200);
    expect(upd.json()).toMatchObject({ title: 'Cambiada', dueDate: null, assigneeId: u.userId });

    const del = await call('DELETE', `/api/orgs/${u.orgId}/cards/${card.id}`, u.cookie);
    expect(del.statusCode).toBe(204);
    expect(t.bus.boardEvents.map((e) => e.event.type)).toEqual([
      'card.created',
      'card.updated',
      'card.deleted',
    ]);
    expect(t.bus.boardEvents[2]!.event).toMatchObject({ type: 'card.deleted', cardId: card.id });
    expect(await boardCards(u, projectId)).toEqual([]);
  });

  it('appends new cards at the end of the column', async () => {
    const { u, projectId, cols } = await setup();
    const a = await mkCard(u, cols[0]!, 'A');
    const b = await mkCard(u, cols[0]!, 'B');
    const c = await mkCard(u, cols[0]!, 'C');
    expect(idsIn(await boardCards(u, projectId), cols[0]!)).toEqual([a.id, b.id, c.id]);
  });

  it('validates title, description and dueDate with 422', async () => {
    const { u, cols } = await setup();
    const url = `/api/orgs/${u.orgId}/columns/${cols[0]}/cards`;
    expect((await call('POST', url, u.cookie, { title: ' ' })).statusCode).toBe(422);
    expect((await call('POST', url, u.cookie, { title: 'x'.repeat(201) })).statusCode).toBe(422);
    expect(
      (await call('POST', url, u.cookie, { title: 'x', description: 'd'.repeat(5001) })).statusCode,
    ).toBe(422);
    expect(
      (await call('POST', url, u.cookie, { title: 'x', dueDate: '31/12/2026' })).statusCode,
    ).toBe(422);
  });

  it('move between columns sets columnId and a position between neighbours', async () => {
    const { u, projectId, cols } = await setup();
    const x = await mkCard(u, cols[1]!, 'X');
    const y = await mkCard(u, cols[1]!, 'Y');
    const m = await mkCard(u, cols[0]!, 'M');
    t.bus.boardEvents.length = 0;
    const res = await move(u, m.id, { toColumnId: cols[1], beforeId: x.id, afterId: y.id });
    expect(res.statusCode).toBe(200);
    expect(res.json<Card>().columnId).toBe(cols[1]);
    const cards = await boardCards(u, projectId);
    expect(idsIn(cards, cols[1]!)).toEqual([x.id, m.id, y.id]);
    expect(idsIn(cards, cols[0]!)).toEqual([]);
    expect(t.bus.boardEvents.map((e) => e.event.type)).toEqual(['card.moved']);
  });

  it('move within the same column reorders it', async () => {
    const { u, projectId, cols } = await setup();
    const a = await mkCard(u, cols[0]!, 'A');
    const b = await mkCard(u, cols[0]!, 'B');
    const c = await mkCard(u, cols[0]!, 'C');
    // Move C to the top: just before A.
    const res = await move(u, c.id, { toColumnId: cols[0], beforeId: null, afterId: a.id });
    expect(res.statusCode).toBe(200);
    expect(idsIn(await boardCards(u, projectId), cols[0]!)).toEqual([c.id, a.id, b.id]);
    // Using itself as a neighbour is ignored: end of column.
    const self = await move(u, c.id, { toColumnId: cols[0], beforeId: c.id, afterId: null });
    expect(self.statusCode).toBe(200);
    expect(idsIn(await boardCards(u, projectId), cols[0]!)).toEqual([a.id, b.id, c.id]);
  });

  it('move with stale beforeId (card now in another column) places at end of target, 200', async () => {
    const { u, projectId, cols } = await setup();
    const t1 = await mkCard(u, cols[1]!, 'T1');
    const t2 = await mkCard(u, cols[1]!, 'T2');
    const stale = await mkCard(u, cols[0]!, 'Stale'); // lives in column 0, not the target
    const m = await mkCard(u, cols[2]!, 'M');
    const res = await move(u, m.id, { toColumnId: cols[1], beforeId: stale.id, afterId: null });
    expect(res.statusCode).toBe(200);
    expect(idsIn(await boardCards(u, projectId), cols[1]!)).toEqual([t1.id, t2.id, m.id]);
  });

  it('move with deleted afterId places at end, 200', async () => {
    const { u, projectId, cols } = await setup();
    const t1 = await mkCard(u, cols[1]!, 'T1');
    const gone = await mkCard(u, cols[1]!, 'Gone');
    const m = await mkCard(u, cols[0]!, 'M');
    await call('DELETE', `/api/orgs/${u.orgId}/cards/${gone.id}`, u.cookie);
    const res = await move(u, m.id, { toColumnId: cols[1], beforeId: null, afterId: gone.id });
    expect(res.statusCode).toBe(200);
    expect(idsIn(await boardCards(u, projectId), cols[1]!)).toEqual([t1.id, m.id]);
  });

  it('move with beforeId null and no valid afterId goes to the end', async () => {
    const { u, projectId, cols } = await setup();
    const t1 = await mkCard(u, cols[1]!, 'T1');
    const m = await mkCard(u, cols[0]!, 'M');
    const res = await move(u, m.id, { toColumnId: cols[1], beforeId: null, afterId: null });
    expect(res.statusCode).toBe(200);
    expect(idsIn(await boardCards(u, projectId), cols[1]!)).toEqual([t1.id, m.id]);
  });

  it('toColumnId from another project → 404', async () => {
    const { u, cols } = await setup();
    const other = await mkProject(u);
    const m = await mkCard(u, cols[0]!, 'M');
    const res = await move(u, m.id, { toColumnId: other.cols[0], beforeId: null, afterId: null });
    expect(res.statusCode).toBe(404);
  });

  it('toColumnId from another org → 404', async () => {
    const { u, cols } = await setup();
    const o = await signUp(t.app, { email: 'o@x.com', orgName: 'O' });
    const foreign = await mkProject(o);
    const m = await mkCard(u, cols[0]!, 'M');
    const res = await move(u, m.id, { toColumnId: foreign.cols[0], beforeId: null, afterId: null });
    expect(res.statusCode).toBe(404);
  });

  it('assigneeId of a user not in the org → 422 validation', async () => {
    const { u, cols } = await setup();
    const outsider = await signUp(t.app, { email: 'out@x.com', orgName: 'Out' });
    const url = `/api/orgs/${u.orgId}/columns/${cols[0]}/cards`;
    const res = await call('POST', url, u.cookie, { title: 'x', assigneeId: outsider.userId });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ error: { code: 'validation' } });

    const card = await mkCard(u, cols[0]!, 'ok');
    const upd = await call('PATCH', `/api/orgs/${u.orgId}/cards/${card.id}`, u.cookie, {
      assigneeId: outsider.userId,
    });
    expect(upd.statusCode).toBe(422);
  });

  it('assigns an org member', async () => {
    const { u, cols } = await setup();
    const m = await signUp(t.app, { email: 'm@x.com', orgName: 'M' });
    await systemDb
      .insert(memberships)
      .values({ organizationId: u.orgId, userId: m.userId, role: 'member' });
    const card = await mkCard(u, cols[0]!, 'c', { assigneeId: m.userId });
    expect(card.assigneeId).toBe(m.userId);
  });

  it('labelIds from another project → 422 validation', async () => {
    const { u, projectId, cols } = await setup();
    const other = await mkProject(u);
    const foreignLabel = await mkLabel(u, other.projectId);
    const own = await mkLabel(u, projectId);
    const url = `/api/orgs/${u.orgId}/columns/${cols[0]}/cards`;
    const res = await call('POST', url, u.cookie, { title: 'x', labelIds: [foreignLabel.id] });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ error: { code: 'validation' } });

    const card = await mkCard(u, cols[0]!, 'ok', { labelIds: [own.id] });
    expect(card.labelIds).toEqual([own.id]);
    const upd = await call('PATCH', `/api/orgs/${u.orgId}/cards/${card.id}`, u.cookie, {
      labelIds: [own.id, foreignLabel.id],
    });
    expect(upd.statusCode).toBe(422);
    const cleared = await call('PATCH', `/api/orgs/${u.orgId}/cards/${card.id}`, u.cookie, {
      labelIds: [],
    });
    expect(cleared.json<Card>().labelIds).toEqual([]);
  });

  it('another org cannot read or touch the card (404)', async () => {
    const { u, cols } = await setup();
    const o = await signUp(t.app, { email: 'o@x.com', orgName: 'O' });
    const card = await mkCard(u, cols[0]!, 'secret');
    expect(
      (await call('PATCH', `/api/orgs/${o.orgId}/cards/${card.id}`, o.cookie, { title: 'x' }))
        .statusCode,
    ).toBe(404);
    expect(
      (await call('DELETE', `/api/orgs/${o.orgId}/cards/${card.id}`, o.cookie)).statusCode,
    ).toBe(404);
    expect(
      (
        await call('POST', `/api/orgs/${o.orgId}/columns/${cols[0]}/cards`, o.cookie, {
          title: 'x',
        })
      ).statusCode,
    ).toBe(404);
  });

  it('update/delete of a missing card → 404', async () => {
    const { u } = await setup();
    const id = '00000000-0000-4000-8000-000000000000';
    expect((await call('PATCH', `/api/orgs/${u.orgId}/cards/${id}`, u.cookie, {})).statusCode).toBe(
      404,
    );
    expect((await call('DELETE', `/api/orgs/${u.orgId}/cards/${id}`, u.cookie)).statusCode).toBe(
      404,
    );
    expect((await call('DELETE', `/api/orgs/${u.orgId}/cards/nope`, u.cookie)).statusCode).toBe(
      404,
    );
  });

  it('position columns use the C collation (bytewise ordering)', async () => {
    const res = await systemDb.execute<{ table_name: string; collation_name: string }>(
      sql`select table_name, collation_name from information_schema.columns
          where column_name = 'position' and table_name in ('cards', 'columns')`,
    );
    expect(res.rows).toHaveLength(2);
    for (const r of res.rows) expect(r.collation_name).toBe('C');
  });
});
