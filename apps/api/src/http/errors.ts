import type { ErrorCode } from '@kanban/shared';
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { pgErrorCode } from '../db/errors';

export type ApiErrorCode = ErrorCode | 'internal_error';

/** Error with an HTTP status and a stable code; the error handler renders it. */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function sendError(
  reply: FastifyReply,
  status: number,
  code: ApiErrorCode,
  message: string,
): FastifyReply {
  return reply.status(status).send({ error: { code, message } });
}

const CODE_BY_STATUS: Record<number, ApiErrorCode> = {
  401: 'unauthenticated',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  429: 'rate_limited',
};

/** Registers the error and not-found handlers: every failure leaves as `{ error: {code, message} }`. */
export function registerErrorHandling(app: FastifyInstance): void {
  app.setNotFoundHandler((_req, reply) => sendError(reply, 404, 'not_found', 'Not found'));

  app.setErrorHandler((err: unknown, req: FastifyRequest, reply: FastifyReply) => {
    if (err instanceof AppError) return sendError(reply, err.status, err.code, err.message);

    if (err instanceof ZodError) {
      const issue = err.issues[0];
      const where = issue?.path.join('.');
      const message = issue ? `${where ? `${where}: ` : ''}${issue.message}` : 'Invalid input';
      return sendError(reply, 422, 'validation', message);
    }

    // SQLSTATE mapping, uniform for app_user and system (owner) queries.
    if (pgErrorCode(err) === '23505') return sendError(reply, 409, 'conflict', 'Already exists');

    const status = (err as Partial<FastifyError> | null)?.statusCode;
    if (typeof status === 'number' && status >= 400 && status < 500) {
      if (status === 400 || status === 413 || status === 415 || status === 422) {
        return sendError(reply, 422, 'validation', 'Invalid request');
      }
      const message = err instanceof Error ? err.message : 'Request failed';
      return sendError(reply, status, CODE_BY_STATUS[status] ?? 'validation', message);
    }

    req.log.error({ err }, 'unhandled error');
    return sendError(reply, 500, 'internal_error', 'Internal server error');
  });
}
