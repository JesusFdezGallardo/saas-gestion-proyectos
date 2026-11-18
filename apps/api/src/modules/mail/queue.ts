import { sql } from 'drizzle-orm';
import pg from 'pg';
import { fromDrizzle, PgBoss, type QueueOptions } from 'pg-boss';
import { loadConfig } from '../../config';
import { onCloseDb, type AppDb } from '../../db/client';
import type { Tx, TxCtx } from '../../db/tx';
import type { EmailJobData } from './templates';

export type { EmailJobData } from './templates';

/**
 * Email jobs live in pg-boss (schema `pgboss`, owner connection). The API enqueues them inside its
 * own `app_user` transaction through `fromDrizzle(tx)`, so a rollback leaves no job behind; for
 * that, `app_user` gets the narrow grants of `QUEUE_GRANTS` (applied by `installQueue`, which the
 * migration script runs after the SQL migrations, and the server again at start).
 */
export const PGBOSS_SCHEMA = 'pgboss';
export const EMAIL_QUEUE = 'email';

/** 3 attempts in total (1 + 2 retries), with exponential backoff (~1 s, ~2 s … between tries). */
export const EMAIL_RETRY: Pick<QueueOptions, 'retryLimit' | 'retryBackoff' | 'retryDelay'> = {
  retryLimit: 2,
  retryBackoff: true,
  retryDelay: 5,
};

/**
 * What `app_user` needs for `send` with a transaction adapter: read the queue settings (the insert
 * joins `pgboss.queue`) and insert into the shared job table, reading back only the new id. It can
 * neither read nor change the jobs themselves (payloads hold other people's addresses).
 */
const QUEUE_GRANTS = `
  GRANT USAGE ON SCHEMA ${PGBOSS_SCHEMA} TO app_user;
  GRANT SELECT ON ${PGBOSS_SCHEMA}.queue TO app_user;
  GRANT INSERT ON ${PGBOSS_SCHEMA}.job_common TO app_user;
  GRANT SELECT (id, start_after) ON ${PGBOSS_SCHEMA}.job_common TO app_user;
`;

function newBoss(connectionString: string, opts: { migrate: boolean; supervise: boolean }) {
  const boss = new PgBoss({
    connectionString,
    schema: PGBOSS_SCHEMA,
    max: 3,
    migrate: opts.migrate,
    supervise: opts.supervise,
    schedule: false,
    application_name: 'kanban-queue',
  });
  // An unhandled 'error' event would crash the process; pg-boss retries on its own.
  boss.on('error', (err) => console.error('pg-boss error', err));
  return boss;
}

/**
 * Creates or upgrades the pg-boss schema, the email queue and the `app_user` grants. Idempotent.
 * Runs with the owner role: from `db:migrate` (Render build, tests' global setup) and at server
 * start (in case a newer pg-boss upgraded its tables).
 */
export async function installQueue(ownerUrl: string): Promise<void> {
  const boss = newBoss(ownerUrl, { migrate: true, supervise: false });
  await boss.start();
  try {
    if (await boss.getQueue(EMAIL_QUEUE)) await boss.updateQueue(EMAIL_QUEUE, EMAIL_RETRY);
    else await boss.createQueue(EMAIL_QUEUE, EMAIL_RETRY);
    const client = new pg.Client({ connectionString: ownerUrl });
    await client.connect();
    try {
      await client.query(QUEUE_GRANTS);
    } finally {
      await client.end();
    }
  } finally {
    await boss.stop({ graceful: false });
  }
}

let shared: Promise<PgBoss> | undefined;

/**
 * The process-wide pg-boss instance (owner pool), started on first use. The server starts it with
 * supervision (maintenance of expired/old jobs) before the worker; elsewhere (tests, scripts)
 * enqueueing starts a plain one.
 */
export function getBoss(opts: { supervise?: boolean } = {}): Promise<PgBoss> {
  shared ??= (async () => {
    const boss = newBoss(loadConfig(process.env).databaseUrlOwner, {
      migrate: false,
      supervise: opts.supervise ?? false,
    });
    await boss.start();
    return boss;
  })().catch((err: unknown) => {
    shared = undefined;
    throw err;
  });
  return shared;
}

export async function stopBoss(): Promise<void> {
  const current = shared;
  shared = undefined;
  if (current) await (await current).stop({ graceful: true, timeout: 5000 });
}
onCloseDb(stopBoss);

/**
 * Queues an email inside the caller's `app_user` transaction: the job exists only if it commits.
 */
export async function enqueueEmail(ctx: Pick<TxCtx, 'tx'>, job: EmailJobData): Promise<void> {
  const boss = await getBoss();
  await boss.send(EMAIL_QUEUE, job, { ...EMAIL_RETRY, db: fromDrizzle(ctx.tx, sql) });
}

/** Deletes every email job (demo reset, tests). Runs in the caller's owner transaction. */
export async function clearEmailJobs(db: AppDb | Tx): Promise<void> {
  const res = await db.execute<{ t: string | null }>(
    sql`select to_regclass(${`${PGBOSS_SCHEMA}.job`})::text as t`,
  );
  if (!res.rows[0]?.t) return; // queue not installed yet
  await db.execute(
    sql`delete from ${sql.identifier(PGBOSS_SCHEMA)}.job where name = ${EMAIL_QUEUE}`,
  );
}
