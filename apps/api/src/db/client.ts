import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema';

function requireEnv(name: 'DATABASE_URL' | 'DATABASE_URL_OWNER'): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

/**
 * Runtime pool, role `app_user` (not table owner): row-level security always applies.
 * Use it only through `withUserTx` / `withOrgTx` so `app.user_id` / `app.org_id` are set.
 */
const appPool = new pg.Pool({ connectionString: requireEnv('DATABASE_URL'), max: 10 });

/**
 * Owner pool (`DATABASE_URL_OWNER`): bypasses RLS. Only for documented system operations
 * (sessions, mail queue, demo reset, seeds, migrations) — never for tenant data on a request.
 */
const systemPool = new pg.Pool({ connectionString: requireEnv('DATABASE_URL_OWNER'), max: 5 });

export const appDb = drizzle(appPool, { schema });
export const systemDb = drizzle(systemPool, { schema });

export type AppDb = typeof appDb;

export async function closeDb(): Promise<void> {
  await Promise.all([appPool.end(), systemPool.end()]);
}
