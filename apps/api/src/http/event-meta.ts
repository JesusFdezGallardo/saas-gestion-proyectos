import type { EventMeta } from '@kanban/shared';
import type { FastifyRequest } from 'fastify';

const MAX_MUTATION_ID = 64;

/** `meta` of every emitted event: the actor plus the client X-Client-Mutation-Id (if valid). */
export function eventMeta(req: FastifyRequest): EventMeta {
  const raw = req.headers['x-client-mutation-id'];
  const id = Array.isArray(raw) ? raw[0] : raw;
  const meta: EventMeta = { actorId: req.user.id };
  if (typeof id === 'string' && id.length > 0 && id.length <= MAX_MUTATION_ID) {
    meta.clientMutationId = id;
  }
  return meta;
}
