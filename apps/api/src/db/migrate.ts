import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { installQueue } from '../modules/mail/queue';

const migrationsFolder = fileURLToPath(new URL('./migrations', import.meta.url));

/**
 * Applies pending migrations with the owner role (tables end up owned by it, not app_user), then
 * installs the pg-boss job queue (its own schema, created by pg-boss) and the app_user grants on it.
 */
export async function runMigrations(ownerUrl: string): Promise<void> {
  const pool = new pg.Pool({ connectionString: ownerUrl, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder });
  } finally {
    await pool.end();
  }
  await installQueue(ownerUrl);
}

const isMain =
  process.argv[1] !== undefined &&
  resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1]);

if (isMain) {
  const url = process.env.DATABASE_URL_OWNER;
  if (!url) {
    console.error('DATABASE_URL_OWNER is not set');
    process.exit(1);
  }
  runMigrations(url)
    .then(() => console.log('Migrations applied'))
    .catch((err: unknown) => {
      console.error(err);
      process.exit(1);
    });
}
