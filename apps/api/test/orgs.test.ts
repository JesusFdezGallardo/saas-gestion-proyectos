import { and, eq } from 'drizzle-orm';
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
const call = (method: Method, url: string, cookie: string, payload?: object) =>
  t.app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });

/** Registers a user (own org) and adds them to `orgId`; optionally flags them as demo. */
async function join(orgId: string, email: string, role: 'admin' | 'member', isDemo = false) {
  const u = await signUp(t.app, { email, name: email.split('@')[0] ?? 'x' });
  await systemDb.insert(memberships).values({ organizationId: orgId, userId: u.userId, role });
  if (isDemo) await systemDb.update(users).set({ isDemo: true }).where(eq(users.id, u.userId));
  return u;
}

const roleOf = async (orgId: string, userId: string) =>
  (
    await systemDb
      .select({ role: memberships.role })
      .from(memberships)
      .where(and(eq(memberships.organizationId, orgId), eq(memberships.userId, userId)))
  )[0]?.role;

const memberUrl = (orgId: string, userId: string) => `/api/orgs/${orgId}/members/${userId}`;

describe('POST /api/orgs', () => {
  it('creates an org with the caller as admin', async () => {
    const a = await signUp(t.app, { email: 'a@x.com' });
    const res = await call('POST', '/api/orgs', a.cookie, { name: 'Second' });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ name: 'Second', role: 'admin' });
    const me = await call('GET', '/api/auth/me', a.cookie);
    expect(me.json().memberships).toHaveLength(2);
    const members = await call('GET', `/api/orgs/${res.json().id}/members`, a.cookie);
    expect(members.json()).toEqual([
      { userId: a.userId, name: 'Test User', email: 'a@x.com', role: 'admin' },
    ]);
  });

  it('validates the name and needs a session', async () => {
    const a = await signUp(t.app, { email: 'a@x.com' });
    expect((await call('POST', '/api/orgs', a.cookie, { name: '  ' })).statusCode).toBe(422);
    const res = await t.app.inject({ method: 'POST', url: '/api/orgs', payload: { name: 'x' } });
    expect(res.statusCode).toBe(401);
  });
});

describe('members', () => {
  it('lists members for any member', async () => {
    const a = await signUp(t.app, { email: 'a@x.com' });
    const m = await join(a.orgId, 'm@x.com', 'member');
    const res = await call('GET', `/api/orgs/${a.orgId}/members`, m.cookie);
    expect(res.statusCode).toBe(200);
    const emails = res.json().map((x: { email: string }) => x.email);
    expect(emails.sort()).toEqual(['a@x.com', 'm@x.com']);
  });

  it('user of org B calling /api/orgs/<orgA>/members → 404', async () => {
    const a = await signUp(t.app, { email: 'a@x.com' });
    const b = await signUp(t.app, { email: 'b@x.com' });
    expect((await call('GET', `/api/orgs/${a.orgId}/members`, b.cookie)).statusCode).toBe(404);
    expect((await call('GET', '/api/orgs/not-a-uuid/members', b.cookie)).statusCode).toBe(404);
    const patch = await call('PATCH', memberUrl(a.orgId, a.userId), b.cookie, { role: 'member' });
    expect(patch.statusCode).toBe(404);
  });

  it('member cannot change roles → 403', async () => {
    const a = await signUp(t.app, { email: 'a@x.com' });
    const m = await join(a.orgId, 'm@x.com', 'member');
    const res = await call('PATCH', memberUrl(a.orgId, m.userId), m.cookie, { role: 'admin' });
    expect(res.statusCode).toBe(403);
    expect(await roleOf(a.orgId, m.userId)).toBe('member');
  });

  it('admin changes a role; validates role and target', async () => {
    const a = await signUp(t.app, { email: 'a@x.com' });
    const m = await join(a.orgId, 'm@x.com', 'member');
    const url = memberUrl(a.orgId, m.userId);
    const res = await call('PATCH', url, a.cookie, { role: 'admin' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ userId: m.userId, role: 'admin' });
    expect((await call('PATCH', url, a.cookie, { role: 'boss' })).statusCode).toBe(422);
    const unknown = memberUrl(a.orgId, '00000000-0000-4000-8000-000000000000');
    expect((await call('PATCH', unknown, a.cookie, { role: 'member' })).statusCode).toBe(404);
  });

  it('cannot remove or demote the last admin → 409 conflict', async () => {
    const a = await signUp(t.app, { email: 'a@x.com' });
    await join(a.orgId, 'm@x.com', 'member');
    const url = memberUrl(a.orgId, a.userId);
    const demote = await call('PATCH', url, a.cookie, { role: 'member' });
    expect(demote.statusCode).toBe(409);
    expect(demote.json().error.code).toBe('conflict');
    expect((await call('DELETE', url, a.cookie)).statusCode).toBe(409);
    expect(await roleOf(a.orgId, a.userId)).toBe('admin');
    expect(t.bus.removed).toEqual([]);
  });

  it('an admin may leave or step down when another admin exists', async () => {
    const a = await signUp(t.app, { email: 'a@x.com' });
    const b = await join(a.orgId, 'b@x.com', 'admin');
    const leave = await call('DELETE', memberUrl(a.orgId, a.userId), a.cookie);
    expect(leave.statusCode).toBe(204);
    expect(await roleOf(a.orgId, a.userId)).toBeUndefined();
    expect(t.bus.removed).toEqual([{ userId: a.userId, orgId: a.orgId }]);
    // b is now the last admin: cannot leave or step down.
    expect((await call('DELETE', memberUrl(a.orgId, b.userId), b.cookie)).statusCode).toBe(409);
    const down = await call('PATCH', memberUrl(a.orgId, b.userId), b.cookie, { role: 'member' });
    expect(down.statusCode).toBe(409);
  });

  it('demo admin cannot remove members or change roles → 403 demo_protected', async () => {
    const a = await signUp(t.app, { email: 'a@x.com' });
    const d = await join(a.orgId, 'd@x.com', 'admin', true);
    const m = await join(a.orgId, 'm@x.com', 'member');
    const url = memberUrl(a.orgId, m.userId);
    const del = await call('DELETE', url, d.cookie);
    expect(del.statusCode).toBe(403);
    expect(del.json().error.code).toBe('demo_protected');
    const patch = await call('PATCH', url, d.cookie, { role: 'admin' });
    expect(patch.statusCode).toBe(403);
    expect(patch.json().error.code).toBe('demo_protected');
    expect(await roleOf(a.orgId, m.userId)).toBe('member');
  });

  it('removing a member calls bus.removeUserFromOrg(userId, orgId)', async () => {
    const a = await signUp(t.app, { email: 'a@x.com' });
    const m = await join(a.orgId, 'm@x.com', 'member');
    const res = await call('DELETE', memberUrl(a.orgId, m.userId), a.cookie);
    expect(res.statusCode).toBe(204);
    expect(t.bus.removed).toEqual([{ userId: m.userId, orgId: a.orgId }]);
    expect(await roleOf(a.orgId, m.userId)).toBeUndefined();
    expect((await call('GET', `/api/orgs/${a.orgId}/members`, m.cookie)).statusCode).toBe(404);
  });

  it('member cannot remove members → 403', async () => {
    const a = await signUp(t.app, { email: 'a@x.com' });
    const m = await join(a.orgId, 'm@x.com', 'member');
    const res = await call('DELETE', memberUrl(a.orgId, a.userId), m.cookie);
    expect(res.statusCode).toBe(403);
  });
});
