import type { DemoUserDto, MeDto } from '@kanban/shared';
import { asc, eq, sql } from 'drizzle-orm';
import { systemDb } from '../../db/client';
import { systemOp } from '../../db/errors';
import { demoState, memberships, organizations, users } from '../../db/schema';
import { AppError } from '../../http/errors';
import type { RealtimeBus } from '../../realtime/bus';
import { createSession, getMe } from '../auth/service';
import { clearEmailJobs } from '../mail/queue';
import { seedDemo } from './seed';

/**
 * Wipes every application table (visitor accounts, sessions, mailbox and all), loads the seed
 * and stamps `demo_state.last_reset_at`, in ONE transaction so nobody sees an empty database.
 * Queued email jobs go too. Then tells every connected browser to reload.
 */
export async function resetDemo(bus: Pick<RealtimeBus, 'broadcast'>): Promise<void> {
  await systemOp(() =>
    systemDb.transaction(async (tx) => {
      const res = await tx.execute<{ tablename: string }>(
        sql`select tablename from pg_tables where schemaname = 'public'`,
      );
      if (res.rows.length > 0) {
        const list = res.rows.map((r) => `"public"."${r.tablename}"`).join(', ');
        await tx.execute(sql.raw(`truncate table ${list} restart identity cascade`));
      }
      // pg-boss keeps its jobs in its own schema: drop the queued emails, keep the queue itself.
      await clearEmailJobs(tx);
      await seedDemo(tx);
      await tx.insert(demoState).values({ id: 1, lastResetAt: new Date() });
    }),
  );
  bus.broadcast('demo:reset');
}

/** The demo users with the organisation they belong to, for the "Entrar como …" buttons. */
export async function listDemoUsers(): Promise<DemoUserDto[]> {
  const rows = await systemOp(() =>
    systemDb
      .select({ id: users.id, email: users.email, name: users.name, orgName: organizations.name })
      .from(users)
      .innerJoin(memberships, eq(memberships.userId, users.id))
      .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
      .where(eq(users.isDemo, true))
      .orderBy(asc(organizations.name), asc(users.name)),
  );
  const seen = new Set<string>();
  const out: DemoUserDto[] = [];
  for (const r of rows) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    out.push({ email: r.email, name: r.name, orgName: r.orgName });
  }
  return out;
}

/** Passwordless session for a demo user. Anyone else (or an unknown email) is a plain 404. */
export async function demoLogin(email: string): Promise<{ token: string; me: MeDto }> {
  const [row] = await systemOp(() =>
    systemDb
      .select({ id: users.id, email: users.email, name: users.name, isDemo: users.isDemo })
      .from(users)
      .where(eq(users.email, email)),
  );
  if (!row?.isDemo) throw new AppError(404, 'not_found', 'Not found');
  const token = await createSession(row.id);
  return { token, me: await getMe(row) };
}
