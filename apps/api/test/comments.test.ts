import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeDb, systemDb } from '../src/db/client';
import { memberships, mentions } from '../src/db/schema';
import { commentHooks } from '../src/modules/comments/service';
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

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';
const call = (method: Method, url: string, cookie: string, payload?: object) =>
  t.app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });
type U = { cookie: string; orgId: string; userId: string };
interface Comment {
  id: string;
  cardId: string;
  authorId: string;
  authorName: string;
  body: string;
  createdAt: string;
  editedAt: string | null;
}

const mention = (u: { userId: string }, name = 'X') => `@[${name}](user:${u.userId})`;

async function setup() {
  const owner: U = await signUp(t.app, { email: 'a@x.com', name: 'Ana' });
  const mate: U = await signUp(t.app, { email: 'b@x.com', name: 'Ben', orgName: 'B' });
  await systemDb
    .insert(memberships)
    .values({ organizationId: owner.orgId, userId: mate.userId, role: 'member' });
  const outsider: U = await signUp(t.app, { email: 'o@x.com', name: 'Out', orgName: 'O' });
  const p = (
    await call('POST', `/api/orgs/${owner.orgId}/projects`, owner.cookie, { name: 'P' })
  ).json<{ id: string }>();
  const board = (
    await call('GET', `/api/orgs/${owner.orgId}/projects/${p.id}/board`, owner.cookie)
  ).json<{ columns: Array<{ id: string }> }>();
  const card = (
    await call(
      'POST',
      `/api/orgs/${owner.orgId}/columns/${board.columns[0]!.id}/cards`,
      owner.cookie,
      { title: 'c' },
    )
  ).json<{ id: string }>();
  return { owner, mate, outsider, projectId: p.id, cardId: card.id };
}
// `mate` signed up with its own org B but is also a member of the owner's org: its session
// cookie works against /api/orgs/<owner.orgId>, so requests below always use the owner's orgId.
const post = (orgId: string, u: U, cardId: string, body: unknown) =>
  call('POST', `/api/orgs/${orgId}/cards/${cardId}/comments`, u.cookie, { body });
const mentionRows = async (commentId: string) =>
  (await systemDb.select().from(mentions).where(eq(mentions.commentId, commentId))).map(
    (r) => r.userId,
  );

describe('comments', () => {
  it('creates, lists oldest first with authorName, and counts them in the card', async () => {
    const { owner, mate, cardId, projectId } = await setup();
    const a = await post(owner.orgId, owner, cardId, '  first  ');
    expect(a.statusCode).toBe(201);
    expect(a.json<Comment>()).toMatchObject({ body: 'first', authorName: 'Ana', editedAt: null });
    await post(owner.orgId, mate, cardId, 'second');
    const list = (
      await call('GET', `/api/orgs/${owner.orgId}/cards/${cardId}/comments`, owner.cookie)
    ).json<Comment[]>();
    expect(list.map((c) => c.body)).toEqual(['first', 'second']);
    expect(list[1]!.authorName).toBe('Ben');
    const board = (
      await call('GET', `/api/orgs/${owner.orgId}/projects/${projectId}/board`, owner.cookie)
    ).json<{ cards: Array<{ commentCount: number }> }>();
    expect(board.cards[0]!.commentCount).toBe(2);
  });

  it('validates the body (empty / whitespace / >5000 / not a string → 422)', async () => {
    const { owner, cardId } = await setup();
    for (const body of ['', '   ', 'x'.repeat(5001), 5]) {
      expect((await post(owner.orgId, owner, cardId, body)).statusCode).toBe(422);
    }
    expect((await post(owner.orgId, owner, cardId, 'x'.repeat(5000))).statusCode).toBe(201);
  });

  it('emits comment.created and card.updated (commentCount) after commit; delete mirrors it', async () => {
    const { owner, cardId } = await setup();
    const c = (await post(owner.orgId, owner, cardId, 'hi')).json<Comment>();
    const ev = t.bus.boardEvents.map((e) => e.event);
    expect(ev.map((e) => e.type)).toEqual(['card.created', 'comment.created', 'card.updated']);
    expect(ev[2]).toMatchObject({ type: 'card.updated', card: { id: cardId, commentCount: 1 } });
    t.bus.boardEvents.length = 0;
    const del = await call('DELETE', `/api/orgs/${owner.orgId}/comments/${c.id}`, owner.cookie);
    expect(del.statusCode).toBe(204);
    const ev2 = t.bus.boardEvents.map((e) => e.event);
    expect(ev2[0]).toMatchObject({ type: 'comment.deleted', commentId: c.id, cardId });
    expect(ev2[1]).toMatchObject({ type: 'card.updated', card: { commentCount: 0 } });
  });

  it('creating a comment stores mention rows only for org members', async () => {
    const { owner, mate, cardId } = await setup();
    const hook = vi.spyOn(commentHooks, 'notifyForComment');
    const c = (
      await post(
        owner.orgId,
        owner,
        cardId,
        `hola ${mention(mate, 'Ben')} y ${mention(owner, 'Ana')}`,
      )
    ).json<Comment>();
    expect((await mentionRows(c.id)).sort()).toEqual([mate.userId, owner.userId].sort());
    expect(hook).toHaveBeenCalledTimes(1);
    const arg = hook.mock.calls[0]![1];
    expect([...arg.newMentionIds].sort()).toEqual([mate.userId, owner.userId].sort());
    expect(arg.actorId).toBe(owner.userId);
    expect(arg.card.id).toBe(cardId);
  });

  it('mention of a user from another org creates no mention row', async () => {
    const { owner, outsider, cardId } = await setup();
    const hook = vi.spyOn(commentHooks, 'notifyForComment');
    const forged = `hi @[Out](user:${outsider.userId}) and @[Ghost](user:00000000-0000-4000-8000-000000000000)`;
    const res = await post(owner.orgId, owner, cardId, forged);
    expect(res.statusCode).toBe(201);
    const c = res.json<Comment>();
    expect(c.body).toBe(forged);
    expect(await mentionRows(c.id)).toEqual([]);
    expect(hook.mock.calls[0]![1].newMentionIds).toEqual([]);
  });

  it('editing a comment reports only newly added mentions to notifyForComment', async () => {
    const { owner, mate, cardId } = await setup();
    const third = await signUp(t.app, { email: 'c@x.com', name: 'Cy', orgName: 'C' });
    await systemDb
      .insert(memberships)
      .values({ organizationId: owner.orgId, userId: third.userId, role: 'member' });
    const c = (await post(owner.orgId, owner, cardId, `a ${mention(mate)}`)).json<Comment>();
    const hook = vi.spyOn(commentHooks, 'notifyForComment');
    const url = `/api/orgs/${owner.orgId}/comments/${c.id}`;
    const res = await call('PATCH', url, owner.cookie, {
      body: `b ${mention(mate)} ${mention(third)}`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<Comment>().editedAt).not.toBeNull();
    expect(hook).toHaveBeenCalledTimes(1);
    expect(hook.mock.calls[0]![1].newMentionIds).toEqual([third.userId]);
    expect((await mentionRows(c.id)).sort()).toEqual([mate.userId, third.userId].sort());

    // dropping a mention removes its row; nothing new to notify
    await call('PATCH', url, owner.cookie, { body: `c ${mention(third)}` });
    expect(hook.mock.calls[1]![1].newMentionIds).toEqual([]);
    expect(await mentionRows(c.id)).toEqual([third.userId]);
    expect(t.bus.boardEvents.some((e) => e.event.type === 'comment.updated')).toBe(true);
  });

  it('non-author edit/delete → 403 (even an org admin)', async () => {
    const { owner, mate, cardId } = await setup();
    const c = (await post(owner.orgId, mate, cardId, 'mine')).json<Comment>();
    const url = `/api/orgs/${owner.orgId}/comments/${c.id}`;
    expect((await call('PATCH', url, owner.cookie, { body: 'x' })).statusCode).toBe(403);
    const del = await call('DELETE', url, owner.cookie);
    expect(del.statusCode).toBe(403);
    expect(del.json()).toMatchObject({ error: { code: 'forbidden' } });
    expect((await call('PATCH', url, mate.cookie, { body: 'x' })).statusCode).toBe(200);
    expect((await call('DELETE', url, mate.cookie)).statusCode).toBe(204);
  });

  it('comment or card of another org / unknown → 404', async () => {
    const { owner, outsider: o, cardId } = await setup();
    const c = (await post(owner.orgId, owner, cardId, 'x')).json<Comment>();
    const patch = await call('PATCH', `/api/orgs/${o.orgId}/comments/${c.id}`, o.cookie, {
      body: 'y',
    });
    expect(patch.statusCode).toBe(404);
    const del = await call('DELETE', `/api/orgs/${o.orgId}/comments/${c.id}`, o.cookie);
    expect(del.statusCode).toBe(404);
    const list = await call('GET', `/api/orgs/${o.orgId}/cards/${cardId}/comments`, o.cookie);
    expect(list.statusCode).toBe(404);
    expect((await post(o.orgId, o, cardId, 'y')).statusCode).toBe(404);
    const bad = await call('PATCH', `/api/orgs/${owner.orgId}/comments/not-a-uuid`, owner.cookie, {
      body: 'y',
    });
    expect(bad.statusCode).toBe(404);
  });

  it('body with <script> is stored verbatim and returned verbatim', async () => {
    const { owner, cardId } = await setup();
    const body = '<script>alert(1)</script> **bold** <b>x</b>';
    const c = (await post(owner.orgId, owner, cardId, body)).json<Comment>();
    expect(c.body).toBe(body);
    const list = (
      await call('GET', `/api/orgs/${owner.orgId}/cards/${cardId}/comments`, owner.cookie)
    ).json<Comment[]>();
    expect(list[0]!.body).toBe(body);
  });

  it('deleting a card cascades its comments without extra events', async () => {
    const { owner, cardId } = await setup();
    await post(owner.orgId, owner, cardId, 'x');
    t.bus.boardEvents.length = 0;
    const del = await call('DELETE', `/api/orgs/${owner.orgId}/cards/${cardId}`, owner.cookie);
    expect(del.statusCode).toBe(204);
    expect(t.bus.boardEvents.map((e) => e.event.type)).toEqual(['card.deleted']);
  });
});
