import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config';
import { closeDb, systemDb } from '../src/db/client';
import { demoState, projects, users } from '../src/db/schema';
import { runResetCheck, startDemoScheduler } from '../src/modules/demo/scheduler';
import { seedDemo } from '../src/modules/demo/seed';
import { cookieFrom, createTestApp, resetDb } from './helpers';

afterAll(closeDb);
beforeEach(resetDb);

const databaseUrl = loadConfig(process.env).databaseUrlOwner;
const NOW = new Date('2026-11-18T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

async function setLastReset(at: Date | null): Promise<void> {
  if (at) await systemDb.insert(demoState).values({ id: 1, lastResetAt: at });
}

describe('scheduler check', () => {
  it('resets when the last reset is 25 h old and not when it is 23 h old', async () => {
    const resetDemo = vi.fn(() => Promise.resolve());
    await setLastReset(hoursAgo(23));
    expect(await runResetCheck({ databaseUrl, resetDemo, now: () => NOW })).toBe('fresh');
    expect(resetDemo).not.toHaveBeenCalled();
    await systemDb.update(demoState).set({ lastResetAt: hoursAgo(25) });
    expect(await runResetCheck({ databaseUrl, resetDemo, now: () => NOW })).toBe('reset');
    expect(resetDemo).toHaveBeenCalledTimes(1);
  });

  it('resets when there has never been a reset', async () => {
    const resetDemo = vi.fn(() => Promise.resolve());
    expect(await runResetCheck({ databaseUrl, resetDemo, now: () => NOW })).toBe('reset');
    expect(resetDemo).toHaveBeenCalledTimes(1);
  });

  it('two concurrent runs reset once (the second finds the lock taken) and release it', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const resetDemo = vi.fn(() => gate);
    const first = runResetCheck({ databaseUrl, resetDemo, now: () => NOW });
    // Wait until the first run is inside the reset, i.e. holds the lock.
    await vi.waitFor(() => expect(resetDemo).toHaveBeenCalledTimes(1));
    const second = await runResetCheck({ databaseUrl, resetDemo, now: () => NOW });
    expect(second).toBe('busy');
    release();
    expect(await first).toBe('reset');
    expect(resetDemo).toHaveBeenCalledTimes(1);
    // Lock released: a later run can take it again.
    expect(
      await runResetCheck({ databaseUrl, resetDemo: () => Promise.resolve(), now: () => NOW }),
    ).toBe('reset');
  });

  it('releases the lock when the reset fails', async () => {
    await expect(
      runResetCheck({
        databaseUrl,
        resetDemo: () => Promise.reject(new Error('boom')),
        now: () => NOW,
      }),
    ).rejects.toThrow('boom');
    const resetDemo = vi.fn(() => Promise.resolve());
    expect(await runResetCheck({ databaseUrl, resetDemo, now: () => NOW })).toBe('reset');
  });
});

describe('startDemoScheduler', () => {
  it('checks on start and every interval, survives errors, and stops', async () => {
    vi.useFakeTimers();
    try {
      const check = vi
        .fn<() => Promise<unknown>>()
        .mockRejectedValueOnce(new Error('first fails'))
        .mockResolvedValue('fresh');
      const log = { error: vi.fn() };
      const s = startDemoScheduler({
        databaseUrl,
        resetDemo: () => Promise.resolve(),
        intervalMs: 1000,
        check,
        log,
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(check).toHaveBeenCalledTimes(1);
      expect(log.error).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(2500);
      expect(check).toHaveBeenCalledTimes(3);
      await s.stop();
      await vi.advanceTimersByTimeAsync(5000);
      expect(check).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('POST /internal/demo/reset', () => {
  const TOKEN = 'a-long-random-reset-token-for-tests-0123456789';
  const post = (t: Awaited<ReturnType<typeof createTestApp>>, authorization?: string) =>
    t.app.inject({
      method: 'POST',
      url: '/internal/demo/reset',
      ...(authorization ? { headers: { authorization } } : {}),
    });

  it('is 404 when DEMO_MODE=false', async () => {
    const t = await createTestApp({ DEMO_RESET_TOKEN: TOKEN });
    expect((await post(t, `Bearer ${TOKEN}`)).statusCode).toBe(404);
    await t.app.close();
  });

  it('answers 401 without a token, with a wrong one and with a different length', async () => {
    const t = await createTestApp({ DEMO_MODE: 'true', DEMO_RESET_TOKEN: TOKEN });
    for (const h of [
      undefined,
      'Bearer nope',
      `Bearer ${TOKEN}x`,
      `Bearer ${TOKEN.slice(0, -1)}X`,
      TOKEN,
    ]) {
      const res = await post(t, h);
      expect(res.statusCode).toBe(401);
      expect(res.json<{ error: { code: string } }>().error.code).toBe('unauthenticated');
    }
    expect(t.bus.broadcasts).toEqual([]);
    await t.app.close();
  });

  it('with the token resets the demo: 204, seeded again, demo:reset broadcast', async () => {
    const t = await createTestApp({ DEMO_MODE: 'true', DEMO_RESET_TOKEN: TOKEN });
    const res = await post(t, `Bearer ${TOKEN}`);
    expect(res.statusCode).toBe(204);
    expect(t.bus.broadcasts).toEqual(['demo:reset']);
    expect((await systemDb.select().from(users)).length).toBe(4);
    expect((await systemDb.select().from(demoState))[0]?.lastResetAt).toBeInstanceOf(Date);
    await t.app.close();
  });
});

describe('demo protections', () => {
  it('a demo user deleting a project → 403 demo_protected, project kept', async () => {
    const t = await createTestApp({ DEMO_MODE: 'true' });
    await seedDemo();
    const login = await t.app.inject({
      method: 'POST',
      url: '/api/auth/demo-login',
      payload: { email: 'ana@demo.local' },
    });
    const cookie = cookieFrom(login.headers['set-cookie']);
    const [p] = await systemDb.select().from(projects);
    const del = await t.app.inject({
      method: 'DELETE',
      url: `/api/orgs/${p!.organizationId}/projects/${p!.id}`,
      headers: { cookie },
    });
    expect(del.statusCode).toBe(403);
    expect(del.json<{ error: { code: string } }>().error.code).toBe('demo_protected');
    expect(await systemDb.select().from(projects).where(eq(projects.id, p!.id))).toHaveLength(1);
    await t.app.close();
  });
});
