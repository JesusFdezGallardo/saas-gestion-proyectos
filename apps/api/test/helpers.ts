import type { BoardEvent, UserEvent } from '@kanban/shared';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { systemDb } from '../src/db/client';
import { clearEmailJobs } from '../src/modules/mail/queue';
import { RecordingTransport } from '../src/modules/mail/transport';
import type { RealtimeBus } from '../src/realtime/bus';

/** Truncates every application table and the queued email jobs (owner role, no RLS). */
export async function resetDb(): Promise<void> {
  await clearEmailJobs(systemDb);
  const res = await systemDb.execute<{ tablename: string }>(
    sql`select tablename from pg_tables where schemaname = 'public'`,
  );
  if (res.rows.length === 0) return;
  const list = res.rows.map((r) => `"public"."${r.tablename}"`).join(', ');
  await systemDb.execute(sql.raw(`truncate table ${list} restart identity cascade`));
}

/** Realtime bus double: records every call instead of emitting. */
export class RecordingBus implements RealtimeBus {
  readonly boardEvents: Array<{ orgId: string; projectId: string; event: BoardEvent }> = [];
  readonly userEvents: Array<{ userId: string; event: UserEvent }> = [];
  readonly removed: Array<{ userId: string; orgId: string }> = [];
  readonly broadcasts: string[] = [];

  toBoard(orgId: string, projectId: string, event: BoardEvent): void {
    this.boardEvents.push({ orgId, projectId, event });
  }
  toUser(userId: string, event: UserEvent): void {
    this.userEvents.push({ userId, event });
  }
  removeUserFromOrg(userId: string, orgId: string): Promise<void> {
    this.removed.push({ userId, orgId });
    return Promise.resolve();
  }
  broadcast(event: 'demo:reset'): void {
    this.broadcasts.push(event);
  }
}

export interface TestApp {
  app: FastifyInstance;
  bus: RecordingBus;
  mail: RecordingTransport;
}

/**
 * Builds the app against the test database. `overrides` are environment variables merged over
 * the test environment. The auth rate limit is effectively off unless a test sets
 * `AUTH_RATE_LIMIT_MAX`, so one file does not throttle another.
 */
export async function createTestApp(overrides: Record<string, string> = {}): Promise<TestApp> {
  const config = loadConfig({
    ...process.env,
    AUTH_RATE_LIMIT_MAX: '1000',
    DEMO_LOGIN_RATE_LIMIT_MAX: '1000',
    ...overrides,
  });
  const bus = new RecordingBus();
  const mail = new RecordingTransport();
  const app = await buildApp({ config, bus, mail, logger: false });
  await app.ready();
  return { app, bus, mail };
}

export const TEST_PASSWORD = 'correct-horse-battery';

/** Extracts `sid=<token>` from a Set-Cookie header, ready to send back as `Cookie`. */
export function cookieFrom(setCookie: string | string[] | number | undefined): string {
  const header = Array.isArray(setCookie) ? setCookie[0] : String(setCookie ?? '');
  return (header ?? '').split(';')[0] ?? '';
}

/** Registers a user (with its own organization) and returns its session cookie and ids. */
export async function signUp(
  app: FastifyInstance,
  opts: { email: string; name?: string; orgName?: string; password?: string },
): Promise<{ cookie: string; userId: string; orgId: string }> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: {
      email: opts.email,
      name: opts.name ?? 'Test User',
      password: opts.password ?? TEST_PASSWORD,
      orgName: opts.orgName ?? 'Test Org',
    },
  });
  if (res.statusCode !== 201) throw new Error(`signUp failed: ${res.statusCode} ${res.body}`);
  const me = res.json<{ user: { id: string }; memberships: Array<{ orgId: string }> }>();
  const orgId = me.memberships[0]?.orgId;
  if (!orgId) throw new Error('signUp: no membership');
  return { cookie: cookieFrom(res.headers['set-cookie']), userId: me.user.id, orgId };
}
