import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import type { Config } from './config';
import { registerErrorHandling, AppError } from './http/errors';
import { registerOriginCheck } from './http/origin-check';
import { authRoutes } from './modules/auth/routes';
import { cardRoutes } from './modules/cards/routes';
import { columnRoutes } from './modules/columns/routes';
import { labelRoutes } from './modules/labels/routes';
import { projectRoutes } from './modules/projects/routes';
import { invitationRoutes } from './modules/invitations/routes';
import { orgRoutes } from './modules/orgs/routes';
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
  const options: FastifyServerOptions = {
    logger: (deps.logger ?? config.nodeEnv !== 'test') && { level: 'info' },
    // Hop count, never `true`: with `true` a client could spoof X-Forwarded-For and rotate its
    // IP to dodge the rate limit. Render has 1 proxy in front (TRUST_PROXY_HOPS=1).
    trustProxy: (_addr, hop) => hop < config.trustProxyHops,
  };
  const app = Fastify(options);
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
  orgRoutes(app);
  invitationRoutes(app);
  projectRoutes(app);
  columnRoutes(app);
  cardRoutes(app);
  labelRoutes(app);

  return app;
}
