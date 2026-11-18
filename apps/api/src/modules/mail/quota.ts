import { sql } from 'drizzle-orm';
import { systemDb, type AppDb } from '../../db/client';
import type { Tx } from '../../db/tx';

/** Real emails per UTC day: in total (below Brevo's free 300), per address and per inviter. */
export const QUOTA_LIMITS = { global: 250, recipient: 10, inviter: 10 } as const;

export type QuotaScope = keyof typeof QUOTA_LIMITS;

export interface QuotaItem {
  scope: QuotaScope;
  key: string;
  limit: number;
}

/** Today's date in UTC (`YYYY-MM-DD`), the day the counters belong to. */
export function utcDay(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

class QuotaExceeded extends Error {}

/**
 * Takes one unit from every counter, or from none. One statement increments each counter that is
 * still under its limit (row locks make it atomic under concurrency); if any counter was already
 * full, fewer rows come back and the (sub)transaction is rolled back, undoing the others.
 * Runs inside `db` when it is a transaction (as a savepoint), else in its own transaction.
 */
export async function tryConsume(
  day: string,
  items: QuotaItem[],
  db: AppDb | Tx = systemDb,
): Promise<boolean> {
  if (items.length === 0) return true;
  // Fixed lock order across callers, so two consumers never wait on each other in a cycle.
  const sorted = [...items].sort((a, b) =>
    a.scope === b.scope ? a.key.localeCompare(b.key) : a.scope.localeCompare(b.scope),
  );
  const values = sql.join(
    sorted.map((i) => sql`(${day}::date, ${i.scope}::quota_scope, ${i.key}, 1, ${i.limit}::int)`),
    sql`, `,
  );
  try {
    await db.transaction(async (tx) => {
      const res = await tx.execute(sql`
        insert into email_quota (day, scope, key, count)
        select v.day, v.scope, v.key, v.count
        from (values ${values}) as v(day, scope, key, count, lim)
        on conflict (day, scope, key) do update
          set count = email_quota.count + 1
          where email_quota.count < (
            select v2.lim from (values ${values}) as v2(day, scope, key, count, lim)
            where v2.scope = excluded.scope and v2.key = excluded.key
          )
        returning 1`);
      if (res.rows.length !== sorted.length) throw new QuotaExceeded();
    });
    return true;
  } catch (err) {
    if (err instanceof QuotaExceeded) return false;
    throw err;
  }
}
