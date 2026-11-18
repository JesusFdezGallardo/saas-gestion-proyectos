import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';

const base = {
  DATABASE_URL: 'postgres://app_user:app_user@localhost:5432/kanban',
  DATABASE_URL_OWNER: 'postgres://postgres:postgres@localhost:5432/kanban',
};

describe('loadConfig', () => {
  it('applies defaults in development', () => {
    const c = loadConfig(base);
    expect(c.databaseUrl).toBe(base.DATABASE_URL);
    expect(c.databaseUrlOwner).toBe(base.DATABASE_URL_OWNER);
    expect(c.mailTransport).toBe('none');
    expect(c.demoMode).toBe(false);
    expect(c.appOrigin).toBe('http://localhost:5173');
    expect(c.authRateLimitMax).toBe(5);
    expect(c.demoLoginRateLimitMax).toBe(30);
    expect(c.logClientIp).toBe(false);
    expect(loadConfig({ ...base, LOG_CLIENT_IP: '1' }).logClientIp).toBe(true);
  });

  it('requires the database urls', () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
  });

  it('rejects placeholder secrets in production', () => {
    expect(() =>
      loadConfig({ ...base, NODE_ENV: 'production', SESSION_SECRET: 'change-me' }),
    ).toThrow(/SESSION_SECRET/);
  });

  it('parses DEMO_MODE', () => {
    expect(loadConfig({ ...base, DEMO_MODE: 'true' }).demoMode).toBe(true);
    expect(loadConfig({ ...base, DEMO_MODE: 'false' }).demoMode).toBe(false);
  });
  it('requires the Brevo API key and sender in production', () => {
    const secrets = {
      SESSION_SECRET: 'x'.repeat(32),
      DEMO_RESET_TOKEN: 'y'.repeat(32),
      UNSUBSCRIBE_SECRET: 'z'.repeat(32),
    };
    const prod = { ...base, ...secrets, NODE_ENV: 'production' };
    expect(() => loadConfig({ ...prod, MAIL_TRANSPORT: 'brevo' })).toThrow(/BREVO_API_KEY/);
    expect(() => loadConfig({ ...prod, MAIL_TRANSPORT: 'brevo', BREVO_API_KEY: 'k' })).toThrow(
      /MAIL_FROM/,
    );
    const c = loadConfig({
      ...prod,
      MAIL_TRANSPORT: 'brevo',
      BREVO_API_KEY: 'k',
      MAIL_FROM: 'Kanban <yo@example.com>',
    });
    expect(c.mailTransport).toBe('brevo');
    expect(c.brevoApiKey).toBe('k');
    expect(() => loadConfig({ ...prod, MAIL_TRANSPORT: 'smtp' })).toThrow(/SMTP_HOST/);
    expect(loadConfig({ ...prod, MAIL_TRANSPORT: 'none' }).mailTransport).toBe('none');
  });
});
