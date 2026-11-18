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
});
