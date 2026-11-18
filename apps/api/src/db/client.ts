import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { loadConfig } from '../config';
import * as schema from './schema';

type Db = NodePgDatabase<typeof schema>;

interface Handle {
  pool: pg.Pool;
  db: Db;
}

let appHandle: Handle | undefined;
let systemHandle: Handle | undefined;

function open(connectionString: string, max: number): Handle {
  const pool = new pg.Pool({ connectionString, max });
  return { pool, db: drizzle(pool, { schema }) };
}

function getApp(): Db {
  appHandle ??= open(loadConfig(process.env).databaseUrl, 10);
  return appHandle.db;
}

function getSystem(): Db {
  systemHandle ??= open(loadConfig(process.env).databaseUrlOwner, 5);
  return systemHandle.db;
}

/** Defers creating the pool (and reading the config) until the first property access. */
function lazy(get: () => Db): Db {
  return new Proxy({} as Db, {
    get(_target, prop) {
      const db = get();
      const value: unknown = Reflect.get(db, prop, db);
      return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(db) : value;
    },
  });
}

/**
 * Runtime pool, role `app_user` (not table owner): row-level security always applies.
 * Use it only through `withUserTx` / `withOrgTx` so `app.user_id` / `app.org_id` are set.
 * Pools are created on first use, so importing this module never throws.
 */
export const appDb: Db = lazy(getApp);

/**
 * Owner pool (`DATABASE_URL_OWNER`): bypasses RLS. Only for documented system operations
 * (sessions, mail queue, demo reset, seeds, migrations) — never for tenant data on a request.
 * Wrap calls in `systemOp` where the caller maps SQLSTATE codes.
 */
export const systemDb: Db = lazy(getSystem);

export type AppDb = Db;

export async function closeDb(): Promise<void> {
  const handles = [appHandle, systemHandle];
  appHandle = undefined;
  systemHandle = undefined;
  await Promise.all(handles.map((h) => h?.pool.end()));
}
