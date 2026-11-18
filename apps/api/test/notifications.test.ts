import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeDb, systemDb } from '../src/db/client';
import { memberships, notifications, userSettings } from '../src/db/schema';
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
interface Notif {
  id: string;
  type: 'mention' | 'assigned' | 'comment';
  orgId: string;
  projectId: string;
  cardId: string;
  cardTitle: string;
  actorName: string;
  createdAt: string;
  readAt: string | null;
}

const mention = (u: { userId: string }, name = 'X') => `@[${name}](user:${u.userId})`;

/** Ana owns the org; Luis and Marta are members (they signed up with their own orgs). */
async function setup() {
  const ana: U = await signUp(t.app, { email: 'a@x.com', name: 'Ana' });
  const luis: U = await signUp(t.app, { email: 'l@x.com', name: 'Luis', orgName: 'L' });
  const marta: U = await signUp(t.app, { email: 'm@x.com', name: 'Marta', orgName: 'M' });
  await systemDb.insert(memberships).values([
    { organizationId: ana.orgId, userId: luis.userId, role: 'member' },
    { organizationId: ana.orgId, userId: marta.userId, role: 'member' },
  ]);
  const p = (
    await call('POST', `/api/orgs/${ana.orgId}/projects`, ana.cookie, { name: 'P' })
  ).json<{ id: string }>();
  const board = (
    await call('GET', `/api/orgs/${ana.orgId}/projects/${p.id}/board`, ana.cookie)
  ).json<{ columns: Array<{ id: string }> }>();
  const colId = board.columns[0]!.id;
  const newCard = async (u: U, extra: object = {}) =>
    (
      await call('POST', `/api/orgs/${ana.orgId}/columns/${colId}/cards`, u.cookie, {
        title: 'Tarea',
        ...extra,
      })
    ).json<{ id: string }>();
  const card = await newCard(ana);
  return { ana, luis, marta, projectId: p.id, card, newCard };
}
const comment = (orgId: string, u: U, cardId: string, body: string) =>
  call('POST', `/api/orgs/${orgId}/cards/${cardId}/comments`, u.cookie, { body });
const list = async (u: U, qs = '') =>
  (await call('GET', `/api/notifications${qs}`, u.cookie)).json<Notif[]>();
const rows = () => systemDb.select().from(notifications);

describe('notifications', () => {
  it('mentioning Luis creates one mention notification for Luis and none for the author', async () => {
    const { ana, luis, card, projectId } = await setup();
    const res = await comment(ana.orgId, ana, card.id, `hola ${mention(luis)} y ${mention(ana)}`);
    expect(res.statusCode).toBe(201);
    const forLuis = await list(luis);
    expect(forLuis).toHaveLength(1);
    expect(forLuis[0]).toMatchObject({
      type: 'mention',
      orgId: ana.orgId,
      projectId,
      cardId: card.id,
      cardTitle: 'Tarea',
      actorName: 'Ana',
      readAt: null,
    });
    expect(await list(ana)).toEqual([]);
    expect(await rows()).toHaveLength(1);
  });

  it('commenting on a card created by Luis and mentioning him gives him only the mention', async () => {
    const { ana, luis, newCard } = await setup();
    const card = await newCard(luis);
    await comment(ana.orgId, ana, card.id, `ey ${mention(luis)}`);
    const forLuis = await list(luis);
    expect(forLuis.map((n) => n.type)).toEqual(['mention']);
  });

  it('comment notifies creator and assignee, not the author, and not edits', async () => {
    const { ana, luis, marta, newCard } = await setup();
    const card = await newCard(luis, { assigneeId: marta.userId });
    // assignment by Luis notified Marta once
    expect((await list(marta)).map((n) => n.type)).toEqual(['assigned']);
    const c = (await comment(ana.orgId, ana, card.id, 'ping')).json<{ id: string }>();
    expect((await list(luis)).map((n) => n.type)).toEqual(['comment']);
    expect((await list(marta)).map((n) => n.type).sort()).toEqual(['assigned', 'comment']);
    await comment(ana.orgId, luis, card.id, 'mine'); // Luis is the author: only Marta gets it
    expect(await list(luis)).toHaveLength(1);
    expect(await list(marta)).toHaveLength(3);
    const before = (await rows()).length;
    await call('PATCH', `/api/orgs/${ana.orgId}/comments/${c.id}`, ana.cookie, { body: 'edit' });
    expect(await rows()).toHaveLength(before);
  });

  it('a creator who left the organization gets nothing', async () => {
    const { ana, luis, newCard } = await setup();
    const card = await newCard(luis);
    await systemDb.delete(memberships).where(eq(memberships.userId, luis.userId));
    await comment(ana.orgId, ana, card.id, 'hi');
    expect(await rows()).toHaveLength(0);
  });

  it('assigning Marta notifies Marta; reassigning to self notifies nobody', async () => {
    const { ana, marta, card } = await setup();
    await call('PATCH', `/api/orgs/${ana.orgId}/cards/${card.id}`, ana.cookie, {
      assigneeId: marta.userId,
    });
    expect((await list(marta)).map((n) => n.type)).toEqual(['assigned']);
    expect(await rows()).toHaveLength(1);
    await call('PATCH', `/api/orgs/${ana.orgId}/cards/${card.id}`, ana.cookie, {
      assigneeId: ana.userId,
    });
    expect(await rows()).toHaveLength(1);
    // unassigning notifies nobody either
    await call('PATCH', `/api/orgs/${ana.orgId}/cards/${card.id}`, ana.cookie, {
      assigneeId: null,
    });
    expect(await rows()).toHaveLength(1);
  });

  it("Luis cannot read or mark Ana's notification (404)", async () => {
    const { ana, luis, card } = await setup();
    await comment(ana.orgId, luis, card.id, `hi ${mention(ana)}`);
    const [n] = await list(ana);
    expect(n).toBeDefined();
    const res = await call('POST', `/api/notifications/${n!.id}/read`, luis.cookie);
    expect(res.statusCode).toBe(404);
    const bad = await call('POST', '/api/notifications/not-a-uuid/read', luis.cookie);
    expect(bad.statusCode).toBe(404);
    expect(await list(luis)).toEqual([]);
    expect((await rows())[0]!.readAt).toBeNull();
    const ok = await call('POST', `/api/notifications/${n!.id}/read`, ana.cookie);
    expect(ok.statusCode).toBe(200);
    expect(ok.json<Notif>().readAt).not.toBeNull();
    expect((await rows())[0]!.readAt).not.toBeNull();
  });

  it('unread-count drops after read-all', async () => {
    const { ana, luis, card } = await setup();
    await comment(ana.orgId, ana, card.id, `a ${mention(luis)}`);
    await comment(ana.orgId, ana, card.id, `b ${mention(luis)}`);
    expect((await call('GET', '/api/notifications/unread-count', luis.cookie)).json()).toEqual({
      count: 2,
    });
    expect((await call('POST', '/api/notifications/read-all', luis.cookie)).statusCode).toBe(204);
    expect((await call('GET', '/api/notifications/unread-count', luis.cookie)).json()).toEqual({
      count: 0,
    });
    expect((await call('GET', '/api/notifications/unread-count', '')).statusCode).toBe(401);
  });

  it('paginates 20 per page, newest first, with a cursor that does not skip equal timestamps', async () => {
    const { ana, luis, card } = await setup();
    const at = new Date('2026-01-01T00:00:00.000Z');
    const values = Array.from({ length: 45 }, (_, i) => ({
      organizationId: ana.orgId,
      userId: luis.userId,
      type: 'comment' as const,
      actorId: ana.userId,
      cardId: card.id,
      // every 3 rows share the same timestamp
      createdAt: new Date(at.getTime() + Math.floor(i / 3) * 1000),
    }));
    await systemDb.insert(notifications).values(values);
    const seen: string[] = [];
    let qs = '';
    for (let page = 0; page < 3; page++) {
      const res = await call('GET', `/api/notifications${qs}`, luis.cookie);
      const items = res.json<Notif[]>();
      expect(items.length).toBe(page < 2 ? 20 : 5);
      seen.push(...items.map((n) => n.id));
      if (page < 2) {
        const last = items[items.length - 1]!;
        qs = `?before=${encodeURIComponent(`${last.createdAt}|${last.id}`)}`;
      }
    }
    expect(new Set(seen).size).toBe(45);
    // a plain ISO timestamp is accepted too (strictly older than it)
    const plain = await list(luis, `?before=${encodeURIComponent('2026-01-01T00:00:01.000Z')}`);
    expect(plain).toHaveLength(3);
    const bad = await call('GET', '/api/notifications?before=nope', luis.cookie);
    expect(bad.statusCode).toBe(422);
  });

  it('notification.created is emitted to user:<id> only after commit', async () => {
    const { ana, luis, card, projectId } = await setup();
    t.bus.userEvents.length = 0;
    // a failing request (unknown card) must not emit anything
    const bad = await comment(
      ana.orgId,
      ana,
      '00000000-0000-4000-8000-000000000000',
      `x ${mention(luis)}`,
    );
    expect(bad.statusCode).toBe(404);
    expect(t.bus.userEvents).toHaveLength(0);

    // at emit time the row must already be committed and visible
    let visibleAtEmit = -1;
    const original = t.bus.toUser.bind(t.bus);
    vi.spyOn(t.bus, 'toUser').mockImplementation((userId, event) => {
      visibleAtEmit = -2; // marker: called
      void rows().then((r) => (visibleAtEmit = r.length));
      original(userId, event);
    });
    const res = await comment(ana.orgId, ana, card.id, `y ${mention(luis)}`);
    expect(res.statusCode).toBe(201);
    await vi.waitFor(() => expect(visibleAtEmit).toBe(1));

    expect(t.bus.userEvents).toHaveLength(1);
    const ev = t.bus.userEvents[0]!;
    expect(ev.userId).toBe(luis.userId);
    expect(ev.event.type).toBe('notification.created');
    const stored = (await rows()).find((r) => r.id === ev.event.notification.id);
    expect(stored).toBeDefined();
    expect(ev.event.notification).toMatchObject({
      type: 'mention',
      projectId,
      cardTitle: 'Tarea',
      actorName: 'Ana',
      readAt: null,
      createdAt: stored!.createdAt.toISOString(),
    });
    expect(ev.event.meta.actorId).toBe(ana.userId);
  });
});

describe('me settings', () => {
  it('defaults to true when the row is missing and PATCH upserts', async () => {
    const ana: U = await signUp(t.app, { email: 'a@x.com', name: 'Ana' });
    await systemDb.delete(userSettings).where(eq(userSettings.userId, ana.userId));
    expect((await call('GET', '/api/me/settings', ana.cookie)).json()).toEqual({
      emailNotifications: true,
    });
    const r = await call('PATCH', '/api/me/settings', ana.cookie, { emailNotifications: false });
    expect(r.json()).toEqual({ emailNotifications: false });
    expect((await call('GET', '/api/me/settings', ana.cookie)).json()).toEqual({
      emailNotifications: false,
    });
    const bad = await call('PATCH', '/api/me/settings', ana.cookie, { emailNotifications: 'x' });
    expect(bad.statusCode).toBe(422);
    const back = await call('PATCH', '/api/me/settings', ana.cookie, { emailNotifications: true });
    expect(back.json()).toEqual({ emailNotifications: true });
  });
});
