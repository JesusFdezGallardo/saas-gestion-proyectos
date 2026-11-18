import { LoginInput, RegisterInput } from '@kanban/shared';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Config } from '../../config';
import { SESSION_COOKIE, requireUser } from '../../http/auth-guard';
import { SESSION_TTL_MS, deleteSession, getMe, login, register } from './service';

const sessionCookieOptions = (config: Config) => ({
  path: '/',
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: config.nodeEnv === 'production',
});

/** Puts the session cookie on the reply (shared by login, register and demo-login). */
export function setSessionCookie(reply: FastifyReply, config: Config, token: string): void {
  void reply.setCookie(SESSION_COOKIE, token, {
    ...sessionCookieOptions(config),
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export function authRoutes(app: FastifyInstance): void {
  const { config } = app;
  const cookieOptions = sessionCookieOptions(config);
  const setSession = (reply: FastifyReply, token: string): void =>
    setSessionCookie(reply, config, token);
  const limit = { config: { rateLimit: { max: config.authRateLimitMax, timeWindow: '1 minute' } } };

  app.post('/api/auth/register', limit, async (req, reply) => {
    const { token, me } = await register(RegisterInput.parse(req.body));
    setSession(reply, token);
    return reply.status(201).send(me);
  });

  app.post('/api/auth/login', limit, async (req, reply) => {
    const { token, me } = await login(LoginInput.parse(req.body));
    setSession(reply, token);
    return me;
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) await deleteSession(token);
    void reply.clearCookie(SESSION_COOKIE, cookieOptions);
    return reply.status(204).send();
  });

  app.get('/api/auth/me', { preHandler: requireUser }, async (req, reply) => {
    // Sliding expiry: hand the browser a fresh 30-day cookie along with the refreshed row.
    const token = req.cookies[SESSION_COOKIE];
    if (token) setSession(reply, token);
    return getMe(req.user);
  });
}
