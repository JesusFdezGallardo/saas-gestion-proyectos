import type { FastifyInstance } from 'fastify';
import type { Config } from '../config';
import { AppError } from './errors';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * CSRF defence on top of SameSite=Lax: a mutating request must carry `Origin` equal to
 * APP_ORIGIN, otherwise 403 `forbidden`.
 *
 * Missing `Origin` header: browsers always send it on cross-site POST/PUT/PATCH/DELETE, so a
 * missing one means a non-browser client (curl, tests). It is rejected in production (the SPA
 * is the only legitimate client) and allowed otherwise so tests and curl work.
 *
 * `/internal/*` (token-authenticated machine endpoints such as the demo reset) is exempt.
 */
export function registerOriginCheck(app: FastifyInstance, config: Config): void {
  const allowed = new URL(config.appOrigin).origin;
  app.addHook('onRequest', (req, _reply, done) => {
    if (!MUTATING.has(req.method) || req.url.startsWith('/internal/')) return done();
    const origin = req.headers.origin;
    if (origin === undefined) {
      return done(
        config.nodeEnv === 'production'
          ? new AppError(403, 'forbidden', 'Origin header required')
          : undefined,
      );
    }
    done(origin === allowed ? undefined : new AppError(403, 'forbidden', 'Origin not allowed'));
  });
}
