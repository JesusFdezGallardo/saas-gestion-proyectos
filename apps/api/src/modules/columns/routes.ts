import { UpdateColumnInput } from '@kanban/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../http/errors';
import { eventMeta } from '../../http/event-meta';
import { requireOrg } from '../../http/org-guard';
import { deleteColumn, updateColumn } from './service';

const columnIdOf = (params: unknown): string => {
  const p = z.object({ columnId: z.uuid() }).safeParse(params);
  if (!p.success) throw new AppError(404, 'not_found', 'Column not found');
  return p.data.columnId;
};

export function columnRoutes(app: FastifyInstance): void {
  const member = { preHandler: requireOrg('member') };

  app.patch('/api/orgs/:orgId/columns/:columnId', member, (req) => {
    const columnId = columnIdOf(req.params);
    const input = UpdateColumnInput.parse(req.body);
    return updateColumn(app.bus, eventMeta(req), req.org.id, columnId, input);
  });

  app.delete('/api/orgs/:orgId/columns/:columnId', member, async (req, reply) => {
    const columnId = columnIdOf(req.params);
    const { moveTo } = z.object({ moveTo: z.uuid().optional() }).parse(req.query);
    await deleteColumn(app.bus, eventMeta(req), req.org.id, columnId, moveTo);
    return reply.status(204).send();
  });
}
