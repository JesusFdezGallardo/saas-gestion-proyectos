import { sql } from 'drizzle-orm';
import { systemDb } from '../src/db/client';

/** Truncates every application table (owner role, so RLS does not apply). */
export async function resetDb(): Promise<void> {
  const res = await systemDb.execute<{ tablename: string }>(
    sql`select tablename from pg_tables where schemaname = 'public'`,
  );
  if (res.rows.length === 0) return;
  const list = res.rows.map((r) => `"public"."${r.tablename}"`).join(', ');
  await systemDb.execute(sql.raw(`truncate table ${list} restart identity cascade`));
}
