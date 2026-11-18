import { CommentInput } from '@kanban/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../http/errors';
import { eventMeta } from '../../http/event-meta';
import { requireOrg } from '../../http/org-guard';
import { createComment, deleteComment, listComments, updateComment } from './service';

const cardIdOf = (params: unknown): string => {
  const p = z.object({ cardId: z.uuid() }).safeParse(params);
  if (!p.success) throw new AppError(404, 'not_found', 'Card not found');
  return p.data.cardId;
};

const commentIdOf = (params: unknown): string => {
  const p = z.object({ commentId: z.uuid() }).safeParse(params);
  if (!p.success) throw new AppError(404, 'not_found', 'Comment not found');
  return p.data.commentId;
};

export function commentRoutes(app: FastifyInstance): void {
  const member = { preHandler: requireOrg('member') };

  app.get('/api/orgs/:orgId/cards/:cardId/comments', member, (req) =>
    listComments(req.user.id, req.org.id, cardIdOf(req.params)),
  );

  app.post('/api/orgs/:orgId/cards/:cardId/comments', member, async (req, reply) => {
    const cardId = cardIdOf(req.params);
    const { body } = CommentInput.parse(req.body);
    const comment = await createComment(app.bus, eventMeta(req), req.org.id, cardId, body);
    return reply.status(201).send(comment);
  });

  app.patch('/api/orgs/:orgId/comments/:commentId', member, (req) => {
    const commentId = commentIdOf(req.params);
    const { body } = CommentInput.parse(req.body);
    return updateComment(app.bus, eventMeta(req), req.org.id, commentId, body);
  });

  app.delete('/api/orgs/:orgId/comments/:commentId', member, async (req, reply) => {
    await deleteComment(app.bus, eventMeta(req), req.org.id, commentIdOf(req.params));
    return reply.status(204).send();
  });
}
