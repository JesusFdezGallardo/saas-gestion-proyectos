import { createHash, randomBytes } from 'node:crypto';
import type { InvitationInfoDto, MeDto } from '@kanban/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { systemDb } from '../../db/client';
import { systemOp } from '../../db/errors';
import { invitations, memberships, organizations } from '../../db/schema';
import { withOrgTx, type TxCtx } from '../../db/tx';
import { AppError } from '../../http/errors';
import { getMe, type SessionUser } from '../auth/service';
import { enqueueEmail } from '../mail/queue';

export const INVITATION_TTL_MS = 7 * 24 * 3600 * 1000;

const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

/**
 * Queues the invitation email in the same transaction as the invitation. It ignores the
 * recipient's notification setting (there may be no account yet) but the worker still honours
 * the blocklist, the demo rule and the daily limits (10 invitations per inviter).
 */
export function enqueueInvitationEmail(
  ctx: Pick<TxCtx, 'tx'>,
  invite: { to: string; link: string; orgName: string; inviterId: string; inviterName: string },
): Promise<void> {
  return enqueueEmail(ctx, {
    kind: 'invitation',
    toEmail: invite.to,
    actorId: invite.inviterId,
    payload: { orgName: invite.orgName, link: invite.link, inviterName: invite.inviterName },
  });
}

/** Creates an invitation (caller already verified as admin of `orgId`) and returns the link. */
export async function createInvitation(
  appOrigin: string,
  actor: SessionUser,
  orgId: string,
  email: string,
): Promise<{ link: string }> {
  const token = randomBytes(32).toString('base64url');
  const link = `${new URL(appOrigin).origin}/invitacion/${token}`;
  await withOrgTx(actor.id, orgId, async (ctx) => {
    await ctx.tx.insert(invitations).values({
      organizationId: orgId,
      email,
      tokenHash: hashToken(token),
      invitedBy: actor.id,
      expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
    });
    const [org] = await ctx.tx
      .select({ name: organizations.name })
      .from(organizations)
      .where(eq(organizations.id, orgId));
    await enqueueInvitationEmail(ctx, {
      to: email,
      link,
      orgName: org?.name ?? '',
      inviterId: actor.id,
      inviterName: actor.name,
    });
  });
  return { link };
}

async function findByToken(token: string) {
  const [row] = await systemOp(() =>
    systemDb
      .select({
        id: invitations.id,
        orgId: invitations.organizationId,
        orgName: organizations.name,
        email: invitations.email,
        expiresAt: invitations.expiresAt,
        acceptedAt: invitations.acceptedAt,
      })
      .from(invitations)
      .innerJoin(organizations, eq(organizations.id, invitations.organizationId))
      .where(eq(invitations.tokenHash, hashToken(token))),
  );
  return row;
}

/** Public: what the invitation page shows before the user logs in. */
export async function getInvitationInfo(token: string): Promise<InvitationInfoDto> {
  const row = await findByToken(token);
  if (!row) throw new AppError(404, 'not_found', 'Invitation not found');
  return {
    orgName: row.orgName,
    email: row.email,
    expired: row.expiresAt.getTime() < Date.now(),
    accepted: row.acceptedAt !== null,
  };
}

export async function acceptInvitation(token: string, user: SessionUser): Promise<MeDto> {
  const row = await findByToken(token);
  if (!row) throw new AppError(404, 'not_found', 'Invitation not found');
  if (row.email.toLowerCase() !== user.email.toLowerCase()) {
    throw new AppError(403, 'forbidden', 'This invitation is for another email address');
  }
  if (row.acceptedAt) throw new AppError(409, 'conflict', 'Invitation already used');
  if (row.expiresAt.getTime() < Date.now()) {
    throw new AppError(409, 'conflict', 'Invitation expired');
  }
  await systemOp(() =>
    systemDb.transaction(async (tx) => {
      // Atomic claim: a concurrent second accept updates 0 rows and gets 409.
      const claimed = await tx
        .update(invitations)
        .set({ acceptedAt: new Date() })
        .where(and(eq(invitations.id, row.id), isNull(invitations.acceptedAt)))
        .returning({ id: invitations.id });
      if (claimed.length === 0) throw new AppError(409, 'conflict', 'Invitation already used');
      // Already a member (unique violation) -> 409 via the shared handler, claim rolled back.
      await tx
        .insert(memberships)
        .values({ organizationId: row.orgId, userId: user.id, role: 'member' });
    }),
  );
  return getMe(user);
}
