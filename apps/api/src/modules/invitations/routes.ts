import { InviteInput } from '@kanban/shared';
import type { FastifyInstance } from 'fastify';
import { requireUser } from '../../http/auth-guard';
import { requireOrg } from '../../http/org-guard';
import { acceptInvitation, createInvitation, getInvitationInfo } from './service';

export function invitationRoutes(app: FastifyInstance): void {
  app.post(
    '/api/orgs/:orgId/invitations',
    { preHandler: requireOrg('admin') },
    async (req, reply) => {
      const { email } = InviteInput.parse(req.body);
      const out = await createInvitation(app.config.appOrigin, req.user, req.org.id, email);
      return reply.status(201).send(out);
    },
  );

  // Public: the invited person may not have an account yet.
  app.get<{ Params: { token: string } }>('/api/invitations/:token', (req) =>
    getInvitationInfo(req.params.token),
  );

  app.post<{ Params: { token: string } }>(
    '/api/invitations/:token/accept',
    { preHandler: requireUser },
    (req) => acceptInvitation(req.params.token, req.user),
  );
}
