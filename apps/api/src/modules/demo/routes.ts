import { LoginInput } from '@kanban/shared';
import type { FastifyInstance } from 'fastify';
import { AppError } from '../../http/errors';
import { setSessionCookie } from '../auth/routes';
import { bearerMatches, runResetCheck } from './scheduler';
import { demoLogin, listDemoUsers, resetDemo } from './service';

const DemoLoginInput = LoginInput.pick({ email: true });

/** Both routes exist only with DEMO_MODE=true; otherwise they answer 404 like any unknown path. */
export function demoRoutes(app: FastifyInstance): void {
  const { config } = app;
  const limit = { config: { rateLimit: { max: config.authRateLimitMax, timeWindow: '1 minute' } } };
  const requireDemoMode = (): void => {
    if (!config.demoMode) throw new AppError(404, 'not_found', 'Not found');
  };

  app.get('/api/demo/users', async () => {
    requireDemoMode();
    return listDemoUsers();
  });

  app.post('/api/auth/demo-login', limit, async (req, reply) => {
    requireDemoMode();
    const { email } = DemoLoginInput.parse(req.body);
    const { token, me } = await demoLogin(email);
    setSessionCookie(reply, config, token);
    return me;
  });

  // Machine endpoint (cron, curl): Bearer token, exempt from the Origin check. Serialised with
  // the hourly check through the same advisory lock.
  app.post(
    '/internal/demo/reset',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      requireDemoMode();
      if (!bearerMatches(req.headers.authorization, config.demoResetToken)) {
        throw new AppError(401, 'unauthenticated', 'Invalid token');
      }
      const outcome = await runResetCheck({
        databaseUrl: config.databaseUrlOwner,
        resetDemo: () => resetDemo(app.bus),
        force: true,
      });
      if (outcome === 'busy') throw new AppError(409, 'conflict', 'A reset is already running');
      return reply.status(204).send();
    },
  );
}
