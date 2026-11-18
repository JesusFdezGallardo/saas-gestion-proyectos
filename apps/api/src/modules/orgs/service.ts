import { randomUUID } from 'node:crypto';
import type { MemberDto, MembershipRole } from '@kanban/shared';
import { and, asc, eq } from 'drizzle-orm';
import { memberships, organizations, users } from '../../db/schema';
import { withOrgTx } from '../../db/tx';
import { AppError } from '../../http/errors';
import type { RealtimeBus } from '../../realtime/bus';

export async function createOrg(
  userId: string,
  name: string,
): Promise<{ id: string; name: string; role: 'admin' }> {
  // The id is generated here so RLS (`id = app.org_id`) lets the creator insert the org and
  // their own admin membership in one transaction.
  const id = randomUUID();
  await withOrgTx(userId, id, async ({ tx }) => {
    await tx.insert(organizations).values({ id, name });
    await tx.insert(memberships).values({ organizationId: id, userId, role: 'admin' });
  });
  return { id, name, role: 'admin' };
}

export function listMembers(userId: string, orgId: string): Promise<MemberDto[]> {
  return withOrgTx(userId, orgId, ({ tx }) =>
    tx
      .select({
        userId: users.id,
        name: users.name,
        email: users.email,
        role: memberships.role,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.organizationId, orgId))
      .orderBy(asc(memberships.createdAt), asc(users.name)),
  );
}

const notFound = () => new AppError(404, 'not_found', 'Member not found');
const lastAdmin = () => new AppError(409, 'conflict', 'An organization needs at least one admin');

/** Locks the org's admin rows so two concurrent demotions cannot both pass the last-admin check. */
async function lockAdmins(tx: Parameters<Parameters<typeof withOrgTx>[2]>[0]['tx'], orgId: string) {
  return tx
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(and(eq(memberships.organizationId, orgId), eq(memberships.role, 'admin')))
    .for('update');
}

export function changeRole(
  actorId: string,
  orgId: string,
  targetId: string,
  role: MembershipRole,
): Promise<MemberDto> {
  return withOrgTx(actorId, orgId, async ({ tx }) => {
    const admins = await lockAdmins(tx, orgId);
    const [target] = await tx
      .select({ role: memberships.role })
      .from(memberships)
      .where(and(eq(memberships.organizationId, orgId), eq(memberships.userId, targetId)));
    if (!target) throw notFound();
    if (target.role === 'admin' && role !== 'admin' && admins.length <= 1) throw lastAdmin();
    await tx
      .update(memberships)
      .set({ role })
      .where(and(eq(memberships.organizationId, orgId), eq(memberships.userId, targetId)));
    const [u] = await tx
      .select({ name: users.name, email: users.email })
      .from(users)
      .where(eq(users.id, targetId));
    if (!u) throw notFound();
    return { userId: targetId, name: u.name, email: u.email, role };
  });
}

/** An admin may remove themselves (leave), unless they are the last admin. */
export function removeMember(
  bus: RealtimeBus,
  actorId: string,
  orgId: string,
  targetId: string,
): Promise<void> {
  return withOrgTx(actorId, orgId, async ({ tx, afterCommit }) => {
    const admins = await lockAdmins(tx, orgId);
    const [target] = await tx
      .select({ role: memberships.role })
      .from(memberships)
      .where(and(eq(memberships.organizationId, orgId), eq(memberships.userId, targetId)));
    if (!target) throw notFound();
    if (target.role === 'admin' && admins.length <= 1) throw lastAdmin();
    await tx
      .delete(memberships)
      .where(and(eq(memberships.organizationId, orgId), eq(memberships.userId, targetId)));
    afterCommit(() => bus.removeUserFromOrg(targetId, orgId));
  });
}
