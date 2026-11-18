import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import type { Config } from './config';
import { registerErrorHandling, AppError } from './http/errors';
import { registerOriginCheck } from './http/origin-check';
import { authRoutes } from './modules/auth/routes';
import { cardRoutes } from './modules/cards/routes';
import { columnRoutes } from './modules/columns/routes';
import { commentRoutes } from './modules/comments/routes';
import { labelRoutes } from './modules/labels/routes';
import { projectRoutes } from './modules/projects/routes';
import { demoRoutes } from './modules/demo/routes';
import { invitationRoutes } from './modules/invitations/routes';
import { notificationRoutes } from './modules/notifications/routes';
import { setNotificationBus } from './modules/notifications/service';
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
  setNotificationBus(deps.bus);

  // The built SPA is served only when it exists (production build); dev and tests never have it.
  const webDist = config.webDistDir ?? fileURLToPath(new URL('../../web/dist', import.meta.url));
  const serveWeb = existsSync(resolve(webDist, 'index.html'));

  registerErrorHandling(app, { spaFallback: serveWeb });
  await app.register(helmet);
  await app.register(cookie);
  // Opt-in per route (`config.rateLimit`): login and register.
  await app.register(rateLimit, {
    global: false,
    errorResponseBuilder: () =>
      new AppError(429, 'rate_limited', 'Too many attempts, try again soon'),
  });
  registerOriginCheck(app, config);

  if (serveWeb) {
    await app.register(fastifyStatic, {
      root: resolve(webDist),
      wildcard: false,
      // Hashed files under /assets never change; index.html must always be revalidated.
      setHeaders: (res, path) => {
        res.header(
          'Cache-Control',
          path.endsWith('.html') ? 'no-cache' : 'public, max-age=31536000, immutable',
        );
      },
    });
    // wildcard:false registers only the existing files at startup + `/`; everything else
    // (client routes) reaches the not-found handler, which serves index.html.
  }

  app.get('/api/health', () => ({ ok: true }));
  authRoutes(app);
  demoRoutes(app);
  orgRoutes(app);
  invitationRoutes(app);
  projectRoutes(app);
  columnRoutes(app);
  cardRoutes(app);
  labelRoutes(app);
  commentRoutes(app);
  notificationRoutes(app);

  return app;
}
