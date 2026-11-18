import type { MembershipRole } from '@kanban/shared';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { getMembershipRole } from '../modules/orgs/service';
import { AppError } from './errors';
import { requireUser } from './auth-guard';

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by `requireOrg`: the organization of `:orgId` and the caller's role in it. */
    org: { id: string; role: MembershipRole };
  }
}

const OrgParams = z.object({ orgId: z.uuid() });

/**
 * preHandlers for routes under `/api/orgs/:orgId`: session, then membership. A non-member (or a
 * malformed/unknown id) gets 404 so the existence of other organizations is never revealed;
 * a member with too low a role gets 403. `withOrgTx` is only used after this check.
 */
export function requireOrg(minRole: MembershipRole) {
  const check = async (req: FastifyRequest): Promise<void> => {
    const parsed = OrgParams.safeParse(req.params);
    if (!parsed.success) throw new AppError(404, 'not_found', 'Not found');
    const orgId = parsed.data.orgId;
    const role = await getMembershipRole(req.user.id, orgId);
    if (!role) throw new AppError(404, 'not_found', 'Not found');
    if (minRole === 'admin' && role !== 'admin') {
      throw new AppError(403, 'forbidden', 'Admin role required');
    }
    req.org = { id: orgId, role };
  };
  return [requireUser, check];
}

/** preHandler: demo accounts cannot perform destructive/privileged actions. */
export async function forbidDemo(req: FastifyRequest): Promise<void> {
  if (req.user.isDemo) {
    throw new AppError(403, 'demo_protected', 'Not allowed for demo accounts');
  }
}
