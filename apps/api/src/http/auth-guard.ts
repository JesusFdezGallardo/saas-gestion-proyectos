import type { FastifyRequest } from 'fastify';
import { getSessionUser, type SessionUser } from '../modules/auth/service';
import { AppError } from './errors';

export const SESSION_COOKIE = 'sid';

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by `requireUser`. */
    user: SessionUser;
  }
}

/** preHandler: resolves the session cookie into `req.user` or answers 401. */
export async function requireUser(req: FastifyRequest): Promise<void> {
  const token = req.cookies[SESSION_COOKIE];
  const user = token ? await getSessionUser(token) : null;
  if (!user) throw new AppError(401, 'unauthenticated', 'Not authenticated');
  req.user = user;
}
