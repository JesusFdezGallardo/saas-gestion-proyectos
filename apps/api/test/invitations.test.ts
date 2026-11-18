import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, systemDb } from '../src/db/client';
import { invitations } from '../src/db/schema';
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

const post = (url: string, cookie: string, payload?: object) =>
  t.app.inject({ method: 'POST', url, headers: { cookie }, ...(payload ? { payload } : {}) });
const get = (url: string, cookie?: string) =>
  t.app.inject({ method: 'GET', url, headers: cookie ? { cookie } : {} });

async function invite(admin: { cookie: string; orgId: string }, email: string) {
  const res = await post(`/api/orgs/${admin.orgId}/invitations`, admin.cookie, { email });
  expect(res.statusCode).toBe(201);
  const { link } = res.json<{ link: string }>();
  return { link, token: link.split('/invitacion/')[1] ?? '' };
}

const expire = (id?: string) =>
  systemDb
    .update(invitations)
    .set({ expiresAt: new Date(Date.now() - 1000) })
    .where(id ? eq(invitations.id, id) : undefined);

describe('create invitation', () => {
  it('admin gets a link; only the token hash is stored', async () => {
    const a = await signUp(t.app, { email: 'a@x.com' });
    const { link, token } = await invite(a, 'New@X.com');
    expect(link).toBe(`${t.app.config.appOrigin}/invitacion/${token}`);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const rows = await systemDb.select().from(invitations);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tokenHash).not.toContain(token);
    expect(rows[0]?.email).toBe('new@x.com');
    const left = rows[0]?.expiresAt.getTime() ?? 0;
    expect(left - Date.now()).toBeGreaterThan(6.9 * 24 * 3600 * 1000);
  });

  it('outsider → 404, bad email → 422, no session → 401', async () => {
    const a = await signUp(t.app, { email: 'a@x.com' });
    const b = await signUp(t.app, { email: 'b@x.com' });
    const url = `/api/orgs/${a.orgId}/invitations`;
    expect((await post(url, b.cookie, { email: 'c@x.com' })).statusCode).toBe(404);
    expect((await post(url, a.cookie, { email: 'nope' })).statusCode).toBe(422);
    const anon = await t.app.inject({ method: 'POST', url, payload: { email: 'c@x.com' } });
    expect(anon.statusCode).toBe(401);
  });
});

describe('GET /api/invitations/:token', () => {
  it('is public and returns org name, email, expired and accepted flags', async () => {
    const a = await signUp(t.app, { email: 'a@x.com', orgName: 'Acme' });
    const { token } = await invite(a, 'c@x.com');
    const res = await get(`/api/invitations/${token}`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      orgName: 'Acme',
      email: 'c@x.com',
      expired: false,
      accepted: false,
    });
    await expire();
    expect((await get(`/api/invitations/${token}`)).json().expired).toBe(true);
  });

  it('says accepted once the invitation has been used', async () => {
    const a = await signUp(t.app, { email: 'a@x.com', orgName: 'Acme' });
    const { token } = await invite(a, 'c@x.com');
    const c = await signUp(t.app, { email: 'c@x.com' });
    const accept = await t.app.inject({
      method: 'POST',
      url: `/api/invitations/${token}/accept`,
      headers: { cookie: c.cookie },
    });
    expect(accept.statusCode).toBe(200);
    expect((await get(`/api/invitations/${token}`)).json()).toMatchObject({ accepted: true });
  });

  it('unknown token → 404', async () => {
    expect((await get('/api/invitations/nope')).statusCode).toBe(404);
  });
});

describe('accept', () => {
  it('creates a member membership and returns it in me', async () => {
    const a = await signUp(t.app, { email: 'a@x.com', orgName: 'Acme' });
    const { token } = await invite(a, 'c@x.com');
    const c = await signUp(t.app, { email: 'C@x.com' });
    const res = await post(`/api/invitations/${token}/accept`, c.cookie);
    expect(res.statusCode).toBe(200);
    expect(res.json().memberships).toContainEqual({
      orgId: a.orgId,
      orgName: 'Acme',
      role: 'member',
    });
    expect((await get(`/api/orgs/${a.orgId}/members`, c.cookie)).statusCode).toBe(200);
  });

  it('needs a session', async () => {
    const a = await signUp(t.app, { email: 'a@x.com' });
    const { token } = await invite(a, 'c@x.com');
    const res = await t.app.inject({ method: 'POST', url: `/api/invitations/${token}/accept` });
    expect(res.statusCode).toBe(401);
  });

  it('says accepted once the invitation has been used', async () => {
    const a = await signUp(t.app, { email: 'a@x.com', orgName: 'Acme' });
    const { token } = await invite(a, 'c@x.com');
    const c = await signUp(t.app, { email: 'c@x.com' });
    const accept = await t.app.inject({
      method: 'POST',
      url: `/api/invitations/${token}/accept`,
      headers: { cookie: c.cookie },
    });
    expect(accept.statusCode).toBe(200);
    expect((await get(`/api/invitations/${token}`)).json()).toMatchObject({ accepted: true });
  });

  it('unknown token → 404', async () => {
    const a = await signUp(t.app, { email: 'a@x.com' });
    expect((await post('/api/invitations/nope/accept', a.cookie)).statusCode).toBe(404);
  });

  it('accept with different account email → 403 forbidden', async () => {
    const a = await signUp(t.app, { email: 'a@x.com' });
    const { token } = await invite(a, 'c@x.com');
    const d = await signUp(t.app, { email: 'd@x.com' });
    const res = await post(`/api/invitations/${token}/accept`, d.cookie);
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('forbidden');
  });

  it('accept expired (>7 days) → 409 conflict', async () => {
    const a = await signUp(t.app, { email: 'a@x.com' });
    const { token } = await invite(a, 'c@x.com');
    await expire();
    const c = await signUp(t.app, { email: 'c@x.com' });
    const res = await post(`/api/invitations/${token}/accept`, c.cookie);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('conflict');
  });

  it('accept twice → second is 409', async () => {
    const a = await signUp(t.app, { email: 'a@x.com' });
    const { token } = await invite(a, 'c@x.com');
    const c = await signUp(t.app, { email: 'c@x.com' });
    expect((await post(`/api/invitations/${token}/accept`, c.cookie)).statusCode).toBe(200);
    expect((await post(`/api/invitations/${token}/accept`, c.cookie)).statusCode).toBe(409);
  });

  it('already a member → 409 and the invitation stays unused', async () => {
    const a = await signUp(t.app, { email: 'a@x.com' });
    const { token } = await invite(a, 'a@x.com');
    const res = await post(`/api/invitations/${token}/accept`, a.cookie);
    expect(res.statusCode).toBe(409);
    const [row] = await systemDb.select().from(invitations);
    expect(row?.acceptedAt).toBeNull();
  });
});
