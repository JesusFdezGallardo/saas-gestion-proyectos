import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { count } from 'drizzle-orm';
import { loadConfig, type Config } from '../../config';
import { closeDb, systemDb } from '../../db/client';
import { organizations } from '../../db/schema';
import { NoopBus } from '../../realtime/bus';
import { resetDemo } from './service';

/** First deploy: loads the seed only in demo mode and only when no organisation exists yet. */
export async function seedIfEmpty(config: Pick<Config, 'demoMode'>): Promise<boolean> {
  if (!config.demoMode) return false;
  const [row] = await systemDb.select({ n: count() }).from(organizations);
  if ((row?.n ?? 0) > 0) return false;
  await resetDemo(new NoopBus());
  return true;
}

const isMain =
  process.argv[1] !== undefined &&
  resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1]);

if (isMain) {
  seedIfEmpty(loadConfig(process.env))
    .then((seeded) => console.log(seeded ? 'Demo data loaded' : 'Demo seed skipped'))
    .catch((err: unknown) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => closeDb());
}
