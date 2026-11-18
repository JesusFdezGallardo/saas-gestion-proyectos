import { LoginInput } from '@kanban/shared';
import type { FastifyInstance } from 'fastify';
import { AppError } from '../../http/errors';
import { setSessionCookie } from '../auth/routes';
import { demoLogin, listDemoUsers } from './service';

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
}
