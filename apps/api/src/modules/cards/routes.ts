import { CreateCardInput, MoveCardInput, UpdateCardInput } from '@kanban/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../http/errors';
import { eventMeta } from '../../http/event-meta';
import { requireOrg } from '../../http/org-guard';
import { createCard, deleteCard, moveCard, updateCard } from './service';

const cardIdOf = (params: unknown): string => {
  const p = z.object({ cardId: z.uuid() }).safeParse(params);
  if (!p.success) throw new AppError(404, 'not_found', 'Card not found');
  return p.data.cardId;
};

const columnIdOf = (params: unknown): string => {
  const p = z.object({ columnId: z.uuid() }).safeParse(params);
  if (!p.success) throw new AppError(404, 'not_found', 'Column not found');
  return p.data.columnId;
};

export function cardRoutes(app: FastifyInstance): void {
  const member = { preHandler: requireOrg('member') };

  app.post('/api/orgs/:orgId/columns/:columnId/cards', member, async (req, reply) => {
    const columnId = columnIdOf(req.params);
    const input = CreateCardInput.parse(req.body);
    const card = await createCard(app.bus, eventMeta(req), req.org.id, columnId, input);
    return reply.status(201).send(card);
  });

  app.patch('/api/orgs/:orgId/cards/:cardId', member, (req) => {
    const cardId = cardIdOf(req.params);
    const input = UpdateCardInput.parse(req.body);
    return updateCard(app.bus, eventMeta(req), req.org.id, cardId, input);
  });

  app.post('/api/orgs/:orgId/cards/:cardId/move', member, (req) => {
    const cardId = cardIdOf(req.params);
    const input = MoveCardInput.parse(req.body);
    return moveCard(app.bus, eventMeta(req), req.org.id, cardId, input);
  });

  app.delete('/api/orgs/:orgId/cards/:cardId', member, async (req, reply) => {
    await deleteCard(app.bus, eventMeta(req), req.org.id, cardIdOf(req.params));
    return reply.status(204).send();
  });
}
