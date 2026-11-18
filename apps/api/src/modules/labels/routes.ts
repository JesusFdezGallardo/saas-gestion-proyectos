import { CreateLabelInput, UpdateLabelInput } from '@kanban/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../http/errors';
import { eventMeta } from '../../http/event-meta';
import { requireOrg } from '../../http/org-guard';
import { createLabel, deleteLabel, updateLabel } from './service';

const labelIdOf = (params: unknown): string => {
  const p = z.object({ labelId: z.uuid() }).safeParse(params);
  if (!p.success) throw new AppError(404, 'not_found', 'Label not found');
  return p.data.labelId;
};

export function labelRoutes(app: FastifyInstance): void {
  const member = { preHandler: requireOrg('member') };

  app.post('/api/orgs/:orgId/projects/:projectId/labels', member, async (req, reply) => {
    const p = z.object({ projectId: z.uuid() }).safeParse(req.params);
    if (!p.success) throw new AppError(404, 'not_found', 'Project not found');
    const input = CreateLabelInput.parse(req.body);
    const label = await createLabel(app.bus, eventMeta(req), req.org.id, p.data.projectId, input);
    return reply.status(201).send(label);
  });

  app.patch('/api/orgs/:orgId/labels/:labelId', member, (req) => {
    const labelId = labelIdOf(req.params);
    const input = UpdateLabelInput.parse(req.body);
    return updateLabel(app.bus, eventMeta(req), req.org.id, labelId, input);
  });

  app.delete('/api/orgs/:orgId/labels/:labelId', member, async (req, reply) => {
    await deleteLabel(app.bus, eventMeta(req), req.org.id, labelIdOf(req.params));
    return reply.status(204).send();
  });
}
