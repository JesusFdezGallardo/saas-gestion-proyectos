import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { appDb, closeDb, systemDb } from '../src/db/client';
import {
  cards,
  columns,
  memberships,
  notifications,
  organizations,
  projects,
  userSettings,
  users,
} from '../src/db/schema';
import { withOrgTx, withUserTx } from '../src/db/tx';
import { resetDb } from './helpers';

const userA = randomUUID();
const userB = randomUUID();
const orgA = randomUUID();
const orgB = randomUUID();
const projectA = randomUUID();
const projectB = randomUUID();
const columnA = randomUUID();
const columnB = randomUUID();
const cardA = randomUUID();
const cardB = randomUUID();

async function seed(): Promise<void> {
  await systemDb.insert(users).values([
    { id: userA, email: 'ana@example.com', name: 'Ana' },
    { id: userB, email: 'luis@example.com', name: 'Luis' },
  ]);
  await systemDb.insert(organizations).values([
    { id: orgA, name: 'Org A' },
    { id: orgB, name: 'Org B' },
  ]);
  await systemDb.insert(memberships).values([
    { organizationId: orgA, userId: userA, role: 'admin' },
    { organizationId: orgB, userId: userB, role: 'admin' },
  ]);
  await systemDb.insert(projects).values([
    { id: projectA, organizationId: orgA, name: 'Project A' },
    { id: projectB, organizationId: orgB, name: 'Project B' },
  ]);
  await systemDb.insert(columns).values([
    { id: columnA, organizationId: orgA, projectId: projectA, name: 'Todo', position: 'a0' },
    { id: columnB, organizationId: orgB, projectId: projectB, name: 'Todo', position: 'a0' },
  ]);
  await systemDb.insert(cards).values([
    {
      id: cardA,
      organizationId: orgA,
      projectId: projectA,
      columnId: columnA,
      title: 'Card A',
      position: 'a0',
      createdBy: userA,
    },
    {
      id: cardB,
      organizationId: orgB,
      projectId: projectB,
      columnId: columnB,
      title: 'Card B',
      position: 'a0',
      createdBy: userB,
    },
  ]);
  await systemDb.insert(notifications).values([
    { organizationId: orgA, userId: userA, type: 'assigned', actorId: userA, cardId: cardA },
    { organizationId: orgB, userId: userB, type: 'assigned', actorId: userB, cardId: cardB },
  ]);
  await systemDb.insert(userSettings).values([{ userId: userA }, { userId: userB }]);
}

beforeEach(async () => {
  await resetDb();
  await seed();
});

afterAll(async () => {
  await closeDb();
});

describe('row-level security', () => {
  it('app_user sees only rows of app.org_id', async () => {
    const rows = await withOrgTx(userA, orgA, ({ tx }) => tx.select().from(projects));
    expect(rows.map((r) => r.organizationId)).toEqual([orgA]);
  });

  it('app_user without app.org_id sees no tenant rows', async () => {
    expect(await withUserTx(userA, ({ tx }) => tx.select().from(cards))).toHaveLength(0);
  });

  it('app_user without any setting sees no tenant rows', async () => {
    expect(await appDb.select().from(cards)).toHaveLength(0);
    expect(await appDb.select().from(organizations)).toHaveLength(0);
    expect(await appDb.select().from(memberships)).toHaveLength(0);
    expect(await appDb.select().from(notifications)).toHaveLength(0);
  });

  it('app_user cannot insert into another org', async () => {
    await expect(
      withOrgTx(userA, orgA, ({ tx }) =>
        tx.insert(projects).values({ organizationId: orgB, name: 'x' }),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('app_user cannot move a row into another org', async () => {
    await expect(
      withOrgTx(userA, orgA, ({ tx }) =>
        tx.update(projects).set({ organizationId: orgB }).where(eq(projects.id, projectA)),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('update and delete of another org rows affect nothing', async () => {
    await withOrgTx(userA, orgA, async ({ tx }) => {
      await tx.update(cards).set({ title: 'hacked' }).where(eq(cards.id, cardB));
      await tx.delete(projects).where(eq(projects.id, projectB));
    });
    const [card] = await systemDb.select().from(cards).where(eq(cards.id, cardB));
    expect(card?.title).toBe('Card B');
    expect(await systemDb.select().from(projects).where(eq(projects.id, projectB))).toHaveLength(1);
  });

  it('a row of org A cannot point to a parent of org B (composite foreign keys)', async () => {
    await expect(
      systemDb.insert(cards).values({
        organizationId: orgA,
        projectId: projectA,
        columnId: columnB,
        title: 'x',
        position: 'a1',
        createdBy: userA,
      }),
    ).rejects.toMatchObject({ cause: { code: '23503', constraint: 'cards_column_fk' } });
  });

  it('organizations: a user sees the orgs they belong to, not others', async () => {
    const rows = await withUserTx(userA, ({ tx }) => tx.select().from(organizations));
    expect(rows.map((r) => r.id)).toEqual([orgA]);
  });

  it('organizations: insert only with the id of app.org_id', async () => {
    const newOrg = randomUUID();
    await withOrgTx(userA, newOrg, async ({ tx }) => {
      await tx.insert(organizations).values({ id: newOrg, name: 'Nueva' });
      await tx.insert(memberships).values({ organizationId: newOrg, userId: userA, role: 'admin' });
    });
    const mine = await withUserTx(userA, ({ tx }) => tx.select().from(organizations));
    expect(new Set(mine.map((o) => o.id))).toEqual(new Set([orgA, newOrg]));
    await expect(
      withOrgTx(userA, newOrg, ({ tx }) =>
        tx.insert(organizations).values({ id: randomUUID(), name: 'Otra' }),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('memberships: own rows across orgs; writes only inside app.org_id', async () => {
    const own = await withUserTx(userA, ({ tx }) => tx.select().from(memberships));
    expect(own.map((m) => m.organizationId)).toEqual([orgA]);
    await expect(
      withOrgTx(userA, orgA, ({ tx }) =>
        tx.insert(memberships).values({ organizationId: orgB, userId: userA, role: 'admin' }),
      ),
    ).rejects.toThrow(/row-level security/);
    // Own membership is visible from another org scope, but cannot be changed from there.
    await withOrgTx(userA, orgB, ({ tx }) =>
      tx.update(memberships).set({ role: 'member' }).where(eq(memberships.userId, userA)),
    );
    const [m] = await systemDb.select().from(memberships).where(eq(memberships.userId, userA));
    expect(m?.role).toBe('admin');
  });

  it('notifications: a user sees and updates only their own, across orgs', async () => {
    const rows = await withUserTx(userA, ({ tx }) => tx.select().from(notifications));
    expect(rows.map((n) => n.userId)).toEqual([userA]);
    await withUserTx(userA, ({ tx }) =>
      tx.update(notifications).set({ readAt: new Date() }).where(eq(notifications.userId, userB)),
    );
    const [b] = await systemDb.select().from(notifications).where(eq(notifications.userId, userB));
    expect(b?.readAt).toBeNull();
  });

  it('notifications: insert for another user only inside app.org_id', async () => {
    await withOrgTx(userA, orgA, ({ tx }) =>
      tx.insert(notifications).values({
        id: randomUUID(),
        organizationId: orgA,
        userId: userB,
        type: 'mention',
        actorId: userA,
        cardId: cardA,
      }),
    );
    await expect(
      withOrgTx(userA, orgA, ({ tx }) =>
        tx.insert(notifications).values({
          id: randomUUID(),
          organizationId: orgB,
          userId: userB,
          type: 'mention',
          actorId: userA,
          cardId: cardB,
        }),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('user_settings: only own row', async () => {
    const rows = await withUserTx(userA, ({ tx }) => tx.select().from(userSettings));
    expect(rows.map((r) => r.userId)).toEqual([userA]);
  });

  it('every table with organization_id has RLS enabled and policies', async () => {
    const res = await systemDb.execute<{ table_name: string; rls: boolean; policies: number }>(sql`
      select c.table_name, cl.relrowsecurity as rls,
             (select count(*)::int from pg_policies p
               where p.schemaname = 'public' and p.tablename = c.table_name) as policies
      from information_schema.columns c
      join pg_namespace n on n.nspname = c.table_schema
      join pg_class cl on cl.relname = c.table_name and cl.relnamespace = n.oid
      where c.table_schema = 'public' and c.column_name = 'organization_id'`);
    expect(res.rows.length).toBeGreaterThanOrEqual(10);
    for (const row of res.rows) {
      expect({ table: row.table_name, rls: row.rls }).toEqual({ table: row.table_name, rls: true });
      expect(row.policies).toBeGreaterThan(0);
    }
  });

  it('app_user is not the owner of tables and cannot bypass RLS', async () => {
    const res = await systemDb.execute<{ tableowner: string }>(
      sql`select tableowner from pg_tables where schemaname = 'public'`,
    );
    expect(res.rows.length).toBeGreaterThan(0);
    expect(res.rows.filter((r) => r.tableowner === 'app_user')).toEqual([]);
    const role = await appDb.execute<{ current_user: string; rolbypassrls: boolean }>(
      sql`select current_user, rolbypassrls from pg_roles where rolname = current_user`,
    );
    expect(role.rows[0]).toEqual({ current_user: 'app_user', rolbypassrls: false });
  });
});

describe('transactions', () => {
  it('afterCommit runs only after commit and not on rollback', async () => {
    const spy = vi.fn();
    let calledInside = true;
    await withOrgTx(userA, orgA, async ({ tx, afterCommit }) => {
      afterCommit(spy);
      await tx.insert(projects).values({ organizationId: orgA, name: 'p' });
      calledInside = spy.mock.calls.length > 0;
    });
    expect(calledInside).toBe(false);
    expect(spy).toHaveBeenCalledTimes(1);

    const spy2 = vi.fn();
    await expect(
      withOrgTx(userA, orgA, async ({ tx, afterCommit }) => {
        afterCommit(spy2);
        await tx.insert(projects).values({ organizationId: orgA, name: 'rolled back' });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(spy2).not.toHaveBeenCalled();
    expect(
      await systemDb.select().from(projects).where(eq(projects.name, 'rolled back')),
    ).toHaveLength(0);
  });

  it('afterCommit errors are logged and swallowed', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const after = vi.fn();
    const result = await withUserTx(userA, async ({ afterCommit }) => {
      afterCommit(() => {
        throw new Error('callback failed');
      });
      afterCommit(async () => {
        throw new Error('async callback failed');
      });
      afterCommit(after);
      return 42;
    });
    expect(result).toBe(42);
    expect(after).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledTimes(2);
    log.mockRestore();
  });

  it('settings are local to the transaction', async () => {
    await withOrgTx(userA, orgA, async () => undefined);
    const res = await appDb.execute<{ org: string | null; usr: string | null }>(
      sql`select nullif(current_setting('app.org_id', true), '') as org,
                 nullif(current_setting('app.user_id', true), '') as usr`,
    );
    expect(res.rows[0]).toEqual({ org: null, usr: null });
  });
});
