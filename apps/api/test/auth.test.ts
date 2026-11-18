import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, systemDb } from '../src/db/client';
import { memberships, sessions, userSettings, users } from '../src/db/schema';
import { getSessionUser } from '../src/modules/auth/service';
import { TEST_PASSWORD, cookieFrom, createTestApp, resetDb, signUp, type TestApp } from './helpers';

let t: TestApp;
const extra: TestApp[] = [];

beforeEach(async () => {
  await resetDb();
  t = await createTestApp();
});
afterAll(async () => {
  await t?.app.close();
  for (const e of extra) await e.app.close();
  await closeDb();
});

const PROD_ENV = {
  NODE_ENV: 'production',
  SESSION_SECRET: 'a'.repeat(40),
  DEMO_RESET_TOKEN: 'b'.repeat(40),
  UNSUBSCRIBE_SECRET: 'c'.repeat(40),
};

async function extraApp(overrides: Record<string, string>): Promise<TestApp> {
  const e = await createTestApp(overrides);
  extra.push(e);
  return e;
}

const register = (payload: unknown, headers: Record<string, string> = {}) =>
  t.app.inject({ method: 'POST', url: '/api/auth/register', payload: payload as object, headers });
const login = (payload: unknown) =>
  t.app.inject({ method: 'POST', url: '/api/auth/login', payload: payload as object });

const body = { email: 'ana@example.com', name: 'Ana', password: TEST_PASSWORD, orgName: 'Acme' };

describe('register', () => {
  it('sets cookie and returns me with admin membership', async () => {
    const res = await register(body);
    expect(res.statusCode).toBe(201);
    const setCookie = String(res.headers['set-cookie']);
    expect(setCookie).toMatch(/^sid=/);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    const me = res.json();
    expect(me.user).toMatchObject({ email: 'ana@example.com', name: 'Ana', isDemo: false });
    expect(me.user).not.toHaveProperty('passwordHash');
    expect(me.memberships).toHaveLength(1);
    expect(me.memberships[0]).toMatchObject({ orgName: 'Acme', role: 'admin' });
    const settings = await systemDb.select().from(userSettings);
    expect(settings).toHaveLength(1);
    expect(settings[0]?.emailNotifications).toBe(true);
  });

  it('stores only a sha256 of the token and an argon2id password hash', async () => {
    const res = await register(body);
    const token = cookieFrom(res.headers['set-cookie']).slice('sid='.length);
    const rows = await systemDb.select().from(sessions);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).not.toBe(token);
    expect(rows[0]?.id).toMatch(/^[0-9a-f]{64}$/);
    const [u] = await systemDb.select().from(users);
    expect(u?.passwordHash).toMatch(/^\$argon2id\$/);
  });

  it('marks the cookie Secure in production', async () => {
    const prod = await extraApp(PROD_ENV);
    const res = await prod.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: body,
      headers: { origin: 'http://localhost:5173' },
    });
    expect(res.statusCode).toBe(201);
    expect(String(res.headers['set-cookie'])).toMatch(/Secure/i);
  });

  it('existing email → 409 conflict (case-insensitive)', async () => {
    await register(body);
    const res = await register({ ...body, email: 'ANA@example.com', orgName: 'Other' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('conflict');
    expect(await systemDb.select().from(memberships)).toHaveLength(1);
  });

  it('invalid body → 422 validation with error.code', async () => {
    for (const bad of [
      undefined,
      {},
      { ...body, password: 'short' },
      { ...body, email: 'not-an-email' },
      { ...body, orgName: '   ' },
    ]) {
      const res = await register(bad);
      expect(res.statusCode).toBe(422);
      expect(res.json().error.code).toBe('validation');
      expect(typeof res.json().error.message).toBe('string');
    }
  });

  it('malformed JSON → 422 validation', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: '{nope',
      headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('validation');
  });
});

describe('login', () => {
  it('correct credentials → 200 me + cookie', async () => {
    await register(body);
    const res = await login({ email: 'Ana@Example.com', password: TEST_PASSWORD });
    expect(res.statusCode).toBe(200);
    expect(String(res.headers['set-cookie'])).toMatch(/^sid=/);
    expect(res.json().user.email).toBe('ana@example.com');
    expect(res.json().memberships[0].role).toBe('admin');
  });

  it('wrong password → 401 unauthenticated, same message as unknown email', async () => {
    await register(body);
    const wrong = await login({ email: body.email, password: 'wrong-password' });
    const unknown = await login({ email: 'nobody@example.com', password: 'wrong-password' });
    expect(wrong.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(wrong.json().error.code).toBe('unauthenticated');
    expect(wrong.json()).toEqual(unknown.json());
  });

  it('user without a password (demo seed) cannot log in', async () => {
    await systemDb.insert(users).values({ email: 'demo@example.com', name: 'Demo', isDemo: true });
    const res = await login({ email: 'demo@example.com', password: 'whatever-123' });
    expect(res.statusCode).toBe(401);
  });

  it('6th failed login in a minute from the same IP → 429 rate_limited', async () => {
    const limited = await extraApp({ AUTH_RATE_LIMIT_MAX: '5' });
    const attempt = (ip: string) =>
      limited.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: 'x@example.com', password: 'wrong-password' },
        remoteAddress: ip,
      });
    for (let i = 0; i < 5; i++) expect((await attempt('10.0.0.1')).statusCode).toBe(401);
    const sixth = await attempt('10.0.0.1');
    expect(sixth.statusCode).toBe(429);
    expect(sixth.json().error.code).toBe('rate_limited');
    expect((await attempt('10.0.0.2')).statusCode).toBe(401);
  });

  it('spoofed X-Forwarded-For cannot dodge the limit behind 1 trusted proxy', async () => {
    const limited = await extraApp({ AUTH_RATE_LIMIT_MAX: '5', TRUST_PROXY_HOPS: '1' });
    const attempt = (i: number) =>
      limited.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: 'x@example.com', password: 'wrong-password' },
        remoteAddress: '10.0.0.1',
        headers: { 'x-forwarded-for': `198.51.100.${i}, 203.0.113.9` },
      });
    for (let i = 1; i <= 5; i++) expect((await attempt(i)).statusCode).toBe(401);
    expect((await attempt(6)).statusCode).toBe(429);
  });

  it('register is rate limited too', async () => {
    const limited = await extraApp({ AUTH_RATE_LIMIT_MAX: '2' });
    const attempt = () =>
      limited.app.inject({ method: 'POST', url: '/api/auth/register', payload: {} });
    await attempt();
    await attempt();
    expect((await attempt()).statusCode).toBe(429);
  });
});

describe('me and logout', () => {
  it('GET /api/auth/me without cookie → 401', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/api/auth/me' });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('unauthenticated');
  });

  it('GET /api/auth/me with cookie → me', async () => {
    const { cookie, userId } = await signUp(t.app, { email: 'ana@example.com' });
    const res = await t.app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.id).toBe(userId);
  });

  it('garbage or unknown token → 401', async () => {
    for (const cookie of ['sid=garbage', `sid=${'a'.repeat(43)}`]) {
      const res = await t.app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
      expect(res.statusCode).toBe(401);
    }
  });

  it('logout deletes session; me afterwards → 401', async () => {
    const { cookie } = await signUp(t.app, { email: 'ana@example.com' });
    const out = await t.app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { cookie },
    });
    expect(out.statusCode).toBe(204);
    expect(String(out.headers['set-cookie'])).toMatch(/sid=;/);
    expect(await systemDb.select().from(sessions)).toHaveLength(0);
    const me = await t.app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    expect(me.statusCode).toBe(401);
  });

  it('logout without a session is still 204', async () => {
    const out = await t.app.inject({ method: 'POST', url: '/api/auth/logout' });
    expect(out.statusCode).toBe(204);
  });

  it('expired session → 401', async () => {
    const { cookie, userId } = await signUp(t.app, { email: 'ana@example.com' });
    await systemDb
      .update(sessions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(sessions.userId, userId));
    const res = await t.app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    expect(res.statusCode).toBe(401);
  });

  it('expiry slides forward when the session is used', async () => {
    const { cookie, userId } = await signUp(t.app, { email: 'ana@example.com' });
    const soon = new Date(Date.now() + 24 * 3600 * 1000);
    await systemDb.update(sessions).set({ expiresAt: soon }).where(eq(sessions.userId, userId));
    await t.app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    const [row] = await systemDb.select().from(sessions).where(eq(sessions.userId, userId));
    expect(row!.expiresAt.getTime()).toBeGreaterThan(Date.now() + 29 * 24 * 3600 * 1000);
  });

  it('getSessionUser returns only public fields, null for unknown tokens', async () => {
    const res = await register(body);
    const token = cookieFrom(res.headers['set-cookie']).slice('sid='.length);
    const user = await getSessionUser(token);
    expect(user).toEqual({
      id: res.json().user.id,
      email: 'ana@example.com',
      name: 'Ana',
      isDemo: false,
    });
    expect(await getSessionUser('nope')).toBeNull();
  });
});

describe('origin check', () => {
  it('POST with a foreign Origin → 403 forbidden', async () => {
    const res = await register(body, { origin: 'https://evil.example' });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('forbidden');
    expect(await systemDb.select().from(users)).toHaveLength(0);
  });

  it('POST with the APP_ORIGIN Origin is allowed', async () => {
    const res = await register(body, { origin: 'http://localhost:5173' });
    expect(res.statusCode).toBe(201);
  });

  it('GET is not checked', async () => {
    const res = await t.app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { origin: 'https://evil.example' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('missing Origin: allowed outside production, rejected in production', async () => {
    expect((await register(body)).statusCode).toBe(201);
    const prod = await extraApp(PROD_ENV);
    const res = await prod.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: body.email, password: TEST_PASSWORD },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('forbidden');
  });
});

describe('misc', () => {
  it('GET /api/health → { ok: true }', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it('unknown route → 404 not_found in the standard error shape', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/api/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('not_found');
  });

  it('sets security headers', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/api/health' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});
