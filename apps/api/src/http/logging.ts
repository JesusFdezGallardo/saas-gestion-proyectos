import type { FastifyInstance, FastifyRequest } from 'fastify';

const REDACTED = '[redacted]';

/**
 * Hides bearer secrets that travel in URLs before they reach the logs: invitation tokens
 * (`/api/invitations/<token>…` and the SPA route `/invitacion/<token>`) and the unsubscribe
 * token (`t=` of `/api/mail/unsubscribe`).
 */
export function redactUrl(url: string): string {
  return url
    .replace(/^(\/api\/invitations\/|\/invitacion\/)[^/?#]+/, `$1${REDACTED}`)
    .replace(/^(\/api\/mail\/unsubscribe\?(?:[^#]*&)?t=)[^&#]*/, `$1${REDACTED}`);
}

/** Fastify's default request serializer, with the URL redacted. */
export function serializeRequest(req: FastifyRequest) {
  return {
    method: req.method,
    url: redactUrl(req.url),
    host: req.host,
    remoteAddress: req.ip,
    // As Fastify's own serializer (undefined under `inject`, which its type does not admit).
    remotePort: req.socket?.remotePort as number,
  };
}

/**
 * `LOG_CLIENT_IP=1`: logs, for `/api/health` only, the client IP the app derives (`ip`, the one
 * the rate limit uses) next to the raw `X-Forwarded-For` and the TCP peer, to check
 * `TRUST_PROXY_HOPS` after a deploy. Off by default; no new endpoint.
 */
export function registerClientIpLog(app: FastifyInstance): void {
  app.addHook('onRequest', (req, _reply, done) => {
    if (req.url === '/api/health' || req.url.startsWith('/api/health?')) {
      req.log.info(
        {
          ip: req.ip,
          forwardedFor: req.headers['x-forwarded-for'] ?? null,
          remoteAddress: req.socket.remoteAddress,
        },
        'client ip',
      );
    }
    done();
  });
}
