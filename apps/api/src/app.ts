import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Config } from './config';
import { registerErrorHandling, AppError } from './http/errors';
import { registerOriginCheck } from './http/origin-check';
import { authRoutes } from './modules/auth/routes';
import type { MailTransport } from './modules/mail/transport';
import type { RealtimeBus } from './realtime/bus';

export interface AppDeps {
  config: Config;
  bus: RealtimeBus;
  mail: MailTransport;
  /** Request logging; defaults to on except when NODE_ENV=test. */
  logger?: boolean;
}

declare module 'fastify' {
  interface FastifyInstance {
    config: Config;
    bus: RealtimeBus;
    mail: MailTransport;
  }
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const { config } = deps;
  const app = Fastify({
    logger: (deps.logger ?? config.nodeEnv !== 'test') && { level: 'info' },
    // Behind Render's proxy the client IP (rate limit key) is in X-Forwarded-For.
    trustProxy: config.nodeEnv === 'production',
  });
  app.decorate('config', config);
  app.decorate('bus', deps.bus);
  app.decorate('mail', deps.mail);

  registerErrorHandling(app);
  await app.register(helmet);
  await app.register(cookie);
  // Opt-in per route (`config.rateLimit`): login and register.
  await app.register(rateLimit, {
    global: false,
    errorResponseBuilder: () =>
      new AppError(429, 'rate_limited', 'Too many attempts, try again soon'),
  });
  registerOriginCheck(app, config);

  app.get('/api/health', () => ({ ok: true }));
  authRoutes(app);

  return app;
}
