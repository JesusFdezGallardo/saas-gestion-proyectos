import { timingSafeEqual } from 'node:crypto';
import pg from 'pg';

export const RESET_AFTER_MS = 24 * 3_600_000;
/** Key of the session advisory lock that serialises demo resets across processes. */
export const RESET_LOCK_KEY = 42;

export interface ResetCheckOptions {
  /**
   * Owner/direct connection string (`DATABASE_URL_OWNER`). Session advisory locks do not work
   * through a PgBouncer transaction-mode pooler (Neon "-pooler" hosts): use the direct URL.
   */
  databaseUrl: string;
  /** Wipes and reseeds the demo (and broadcasts `demo:reset`). */
  resetDemo: () => Promise<void>;
  now?: () => Date;
  /** Reset regardless of the age of the last reset (the `/internal/demo/reset` endpoint). */
  force?: boolean;
  log?: { error(obj: unknown, msg?: string): void };
  /** Replaces the dedicated connection (tests). */
  createClient?: () => pg.Client;
}

/**
 * Resets the demo when the last reset is older than 24 h (or there never was one). The check and
 * the reset run under `pg_try_advisory_lock(42)` held on ONE dedicated connection for the whole
 * operation, so overlapping runs (two instances, a tick and the endpoint) reset at most once.
 * Resolves `'reset'`, `'fresh'` (nothing to do) or `'busy'` (another run holds the lock).
 */
export async function runResetCheck(opts: ResetCheckOptions): Promise<'reset' | 'fresh' | 'busy'> {
  const now = opts.now ?? (() => new Date());
  const client = opts.createClient?.() ?? new pg.Client({ connectionString: opts.databaseUrl });
  // The client idles while the reset runs on another connection: if its connection drops, pg
  // emits 'error'; without a listener that would crash the process. The next tick retries.
  client.on('error', (err) => opts.log?.error(err, 'demo reset lock connection error'));
  let locked = false;
  try {
    await client.connect();
    const got = await client.query<{ ok: boolean }>('select pg_try_advisory_lock($1) as ok', [
      RESET_LOCK_KEY,
    ]);
    locked = got.rows[0]?.ok === true;
    if (!locked) return 'busy';
    if (!opts.force) {
      const res = await client.query<{ last_reset_at: Date | null }>(
        'select last_reset_at from demo_state where id = 1',
      );
      const last = res.rows[0]?.last_reset_at;
      if (last && now().getTime() - last.getTime() <= RESET_AFTER_MS) return 'fresh';
    }
    await opts.resetDemo();
    return 'reset';
  } finally {
    if (locked)
      await client.query('select pg_advisory_unlock($1)', [RESET_LOCK_KEY]).catch(() => undefined);
    await client.end().catch(() => undefined);
  }
}

export interface DemoScheduler {
  /** Runs one check now (also what each interval does). */
  tick(): Promise<void>;
  /** Stops the timer and waits for a check that is in flight. */
  stop(): Promise<void>;
}

export interface SchedulerOptions extends ResetCheckOptions {
  intervalMs?: number;
  log?: { error(obj: unknown, msg?: string): void };
  /** Replaces the check (tests); defaults to `runResetCheck(options)`. */
  check?: () => Promise<unknown>;
}

/** Checks on start and then every `intervalMs` (1 h). The timer never keeps the process alive. */
export function startDemoScheduler(opts: SchedulerOptions): DemoScheduler {
  const check = opts.check ?? (() => runResetCheck(opts));
  let inFlight: Promise<void> = Promise.resolve();
  let stopped = false;
  const tick = (): Promise<void> => {
    if (stopped) return Promise.resolve();
    inFlight = inFlight.then(async () => {
      try {
        await check();
      } catch (err) {
        opts.log?.error(err, 'demo reset check failed');
      }
    });
    return inFlight;
  };
  void tick();
  const timer = setInterval(() => void tick(), opts.intervalMs ?? 3_600_000);
  timer.unref();
  return {
    tick,
    async stop() {
      stopped = true;
      clearInterval(timer);
      await inFlight;
    },
  };
}

/** Constant-time check of an `Authorization: Bearer <token>` header; false on any mismatch. */
export function bearerMatches(header: string | undefined, token: string): boolean {
  const match = /^Bearer\s+(.+)$/i.exec(header ?? '');
  if (!match?.[1]) return false;
  const a = Buffer.from(match[1]);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}
