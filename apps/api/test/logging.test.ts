import { Writable } from 'node:stream';
import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { closeDb } from '../src/db/client';
import { redactUrl } from '../src/http/logging';
import { RecordingTransport } from '../src/modules/mail/transport';
import { RecordingBus } from './helpers';

const apps: Array<{ close(): Promise<unknown> }> = [];
afterAll(async () => {
  for (const a of apps) await a.close();
  await closeDb();
});

/** An app that logs (as in production) into an array of parsed JSON lines. */
async function loggingApp(overrides: Record<string, string> = {}) {
  const lines: Array<Record<string, unknown>> = [];
  const stream = new Writable({
    write(chunk: Buffer, _enc, cb) {
      for (const l of chunk.toString().split('\n')) if (l) lines.push(JSON.parse(l));
      cb();
    },
  });
  const config = loadConfig({ ...process.env, ...overrides });
  const app = await buildApp({
    config,
    bus: new RecordingBus(),
    mail: new RecordingTransport(),
    logger: true,
    logStream: stream,
  });
  apps.push(app);
  await app.ready();
  return { app, lines };
}

const TOKEN = 'k3J9-secret_invitation_token_value';

describe('redactUrl', () => {
  it.each([
    [`/api/invitations/${TOKEN}`, '/api/invitations/[redacted]'],
    [`/api/invitations/${TOKEN}/accept`, '/api/invitations/[redacted]/accept'],
    [`/invitacion/${TOKEN}?x=1`, '/invitacion/[redacted]?x=1'],
    [
      `/api/mail/unsubscribe?e=a%40x.com&t=${TOKEN}`,
      '/api/mail/unsubscribe?e=a%40x.com&t=[redacted]',
    ],
    ['/api/mail/unsubscribe?t=abc&e=a%40x.com', '/api/mail/unsubscribe?t=[redacted]&e=a%40x.com'],
    ['/api/orgs/1/invitations', '/api/orgs/1/invitations'],
    ['/api/health', '/api/health'],
  ])('%s → %s', (url, expected) => {
    expect(redactUrl(url)).toBe(expected);
  });
});

describe('request logs', () => {
  it('never contain an invitation token or an unsubscribe token', async () => {
    const { app, lines } = await loggingApp();
    await app.inject({ method: 'GET', url: `/api/invitations/${TOKEN}` });
    await app.inject({ method: 'GET', url: `/api/mail/unsubscribe?e=a%40x.com&t=${TOKEN}` });
    const all = JSON.stringify(lines);
    expect(all).not.toContain(TOKEN);
    const urls = lines.map((l) => (l.req as { url?: string } | undefined)?.url).filter(Boolean);
    expect(urls).toContain('/api/invitations/[redacted]');
    expect(urls).toContain('/api/mail/unsubscribe?e=a%40x.com&t=[redacted]');
  });

  it('logs the client IP of /api/health only with LOG_CLIENT_IP=1', async () => {
    const off = await loggingApp();
    await off.app.inject({ method: 'GET', url: '/api/health', remoteAddress: '10.0.0.7' });
    expect(off.lines.filter((l) => l.msg === 'client ip')).toEqual([]);

    const on = await loggingApp({ LOG_CLIENT_IP: '1', TRUST_PROXY_HOPS: '1' });
    await on.app.inject({
      method: 'GET',
      url: '/api/health',
      remoteAddress: '10.0.0.7',
      headers: { 'x-forwarded-for': '203.0.113.5' },
    });
    await on.app.inject({ method: 'GET', url: '/api/demo/users', remoteAddress: '10.0.0.7' });
    const logged = on.lines.filter((l) => l.msg === 'client ip');
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({
      level: 30,
      ip: '203.0.113.5',
      forwardedFor: '203.0.113.5',
      remoteAddress: '10.0.0.7',
    });
  });
});
