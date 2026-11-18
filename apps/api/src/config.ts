import { z } from 'zod';

const PLACEHOLDER = 'change-me';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .default('false')
  .transform((v) => v === 'true' || v === '1');

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    DATABASE_URL: z.url(),
    DATABASE_URL_OWNER: z.url(),
    SESSION_SECRET: z.string().min(1).default(PLACEHOLDER),
    APP_ORIGIN: z.url().default('http://localhost:5173'),
    MAIL_TRANSPORT: z.enum(['none', 'smtp', 'brevo']).default('none'),
    SMTP_HOST: z.string().default('localhost'),
    SMTP_PORT: z.coerce.number().int().positive().default(1025),
    SMTP_USER: z.string().default(''),
    SMTP_PASS: z.string().default(''),
    MAIL_FROM: z.string().min(1).default('Kanban <no-reply@localhost>'),
    DEMO_MODE: bool,
    DEMO_RESET_TOKEN: z.string().min(1).default(PLACEHOLDER),
    UNSUBSCRIBE_SECRET: z.string().min(1).default(PLACEHOLDER),
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).default(0),
    AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(5),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return;
    for (const key of ['SESSION_SECRET', 'DEMO_RESET_TOKEN', 'UNSUBSCRIBE_SECRET'] as const) {
      if (env[key] === PLACEHOLDER || env[key].length < 32) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: `${key} must be set to a random value of at least 32 characters in production`,
        });
      }
    }
  });

export interface Config {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  databaseUrl: string;
  databaseUrlOwner: string;
  sessionSecret: string;
  appOrigin: string;
  mailTransport: 'none' | 'smtp' | 'brevo';
  smtp: { host: string; port: number; user: string; pass: string };
  mailFrom: string;
  demoMode: boolean;
  demoResetToken: string;
  unsubscribeSecret: string;
  /** Reverse proxies in front of the app whose X-Forwarded-For entries are trusted (0 = none). */
  trustProxyHops: number;
  /** Login/register attempts allowed per minute and IP. */
  authRateLimitMax: number;
}

/** Parses and validates environment variables. Throws a readable error listing bad keys. */
export function loadConfig(env: Record<string, string | undefined>): Config {
  // Empty strings count as "not set" so defaults apply (e.g. `SMTP_USER=` in .env).
  const cleaned = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== ''));
  const parsed = EnvSchema.safeParse(cleaned);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new Error(`Invalid configuration: ${details}`);
  }
  const e = parsed.data;
  return {
    nodeEnv: e.NODE_ENV,
    port: e.PORT,
    databaseUrl: e.DATABASE_URL,
    databaseUrlOwner: e.DATABASE_URL_OWNER,
    sessionSecret: e.SESSION_SECRET,
    appOrigin: e.APP_ORIGIN,
    mailTransport: e.MAIL_TRANSPORT,
    smtp: { host: e.SMTP_HOST, port: e.SMTP_PORT, user: e.SMTP_USER, pass: e.SMTP_PASS },
    mailFrom: e.MAIL_FROM,
    demoMode: e.DEMO_MODE,
    demoResetToken: e.DEMO_RESET_TOKEN,
    unsubscribeSecret: e.UNSUBSCRIBE_SECRET,
    trustProxyHops: e.TRUST_PROXY_HOPS,
    authRateLimitMax: e.AUTH_RATE_LIMIT_MAX,
  };
}
