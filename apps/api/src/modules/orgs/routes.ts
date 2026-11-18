import { CreateOrgInput, UpdateMemberRoleInput } from '@kanban/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../../http/auth-guard';
import { AppError } from '../../http/errors';
import { forbidDemo, requireOrg } from '../../http/org-guard';
import { changeRole, createOrg, listMembers, removeMember } from './service';

/** `:userId` of the member routes; a malformed id cannot match anyone, so 404. */
const memberId = (params: unknown): string => {
  const p = z.object({ userId: z.uuid() }).safeParse(params);
  if (!p.success) throw new AppError(404, 'not_found', 'Member not found');
  return p.data.userId;
};

export function orgRoutes(app: FastifyInstance): void {
  app.post('/api/orgs', { preHandler: requireUser }, async (req, reply) => {
    const { name } = CreateOrgInput.parse(req.body);
    return reply.status(201).send(await createOrg(req.user.id, name));
  });

  app.get('/api/orgs/:orgId/members', { preHandler: requireOrg('member') }, (req) =>
    listMembers(req.user.id, req.org.id),
  );

  app.patch(
    '/api/orgs/:orgId/members/:userId',
    { preHandler: [...requireOrg('admin'), forbidDemo] },
    (req) => {
      const targetId = memberId(req.params);
      const { role } = UpdateMemberRoleInput.parse(req.body);
      return changeRole(req.user.id, req.org.id, targetId, role);
    },
  );

  app.delete(
    '/api/orgs/:orgId/members/:userId',
    { preHandler: [...requireOrg('admin'), forbidDemo] },
    async (req, reply) => {
      await removeMember(app.bus, req.user.id, req.org.id, memberId(req.params));
      return reply.status(204).send();
    },
  );
}
