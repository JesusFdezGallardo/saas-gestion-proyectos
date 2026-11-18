// Starts the production-like app for the e2e run: fresh database, migrations, demo seed and the
// API serving the already built SPA. Playwright's webServer runs this and kills it at the end.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const root = fileURLToPath(new URL('../..', import.meta.url));
const port = process.env.E2E_PORT ?? '3130';
const dbName = process.env.E2E_DB_NAME ?? 'kanban_e2e';
const ownerEnv = process.env.E2E_OWNER_URL ?? 'postgres://postgres:postgres@localhost:5432';
const appEnv = process.env.E2E_APP_URL ?? 'postgres://app_user:app_user@localhost:5432';

function refuse(message) {
  console.error(message);
  process.exit(1);
}

/**
 * This script DROPs a database with owner credentials, so the connection strings are parsed and
 * rebuilt from their parts (never concatenated from the raw value): only a local server, no
 * query string (pg would honour `?host=...`), no fragment and no database path are accepted.
 */
function parseBase(name, value) {
  let u;
  try {
    u = new URL(value);
  } catch {
    return refuse(
      `${name} refused: not a valid URL (expected postgres://user:pass@localhost:5432)`,
    );
  }
  if (u.protocol !== 'postgres:' && u.protocol !== 'postgresql:') {
    return refuse(`${name} refused: the protocol must be postgres://`);
  }
  if (u.search !== '' || u.hash !== '' || (u.pathname !== '' && u.pathname !== '/')) {
    return refuse(`${name} refused: no database path, query string or fragment allowed`);
  }
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
    return refuse(`${name} host "${host}" refused: only localhost, 127.0.0.1 or ::1`);
  }
  const auth = u.username ? `${u.username}${u.password ? `:${u.password}` : ''}@` : '';
  return (database) => `postgres://${auth}${u.hostname}:${u.port || '5432'}/${database}`;
}

if (!/^kanban_e2e[a-z0-9_]*$/.test(dbName)) {
  refuse(`E2E_DB_NAME "${dbName}" refused: it must match ^kanban_e2e[a-z0-9_]*$`);
}
const ownerUrl = parseBase('E2E_OWNER_URL', ownerEnv);
const appUrl = parseBase('E2E_APP_URL', appEnv);

// NODE_ENV stays out of "production": the session cookie is Secure there and the run is plain http.
const env = {
  ...process.env,
  NODE_ENV: 'development',
  PORT: port,
  APP_ORIGIN: `http://localhost:${port}`,
  DATABASE_URL: appUrl(dbName),
  DATABASE_URL_OWNER: ownerUrl(dbName),
  DEMO_MODE: 'true',
  MAIL_TRANSPORT: 'none',
  SESSION_SECRET: 'e2e-session-secret-e2e-session-secret',
  DEMO_RESET_TOKEN: 'e2e-reset-token-e2e-reset-token-00',
  UNSUBSCRIBE_SECRET: 'e2e-unsubscribe-secret-e2e-unsub00',
  AUTH_RATE_LIMIT_MAX: '1000',
};

function run(args, label) {
  return new Promise((resolve, reject) => {
    const child = spawn('pnpm', args, { cwd: root, env, stdio: 'inherit', shell: true });
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${label} failed (${code})`)),
    );
  });
}

// Drop and recreate the dedicated database: every run starts from the same seed.
const admin = new pg.Client({ connectionString: ownerUrl('postgres') });
await admin.connect();
await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
await admin.query(`CREATE DATABASE "${dbName}"`);
await admin.query(`GRANT CONNECT ON DATABASE "${dbName}" TO app_user`);
await admin.end();

if (process.env.E2E_SKIP_BUILD !== '1') await run(['--filter', '@kanban/web', 'build'], 'build');
await run(['--filter', '@kanban/api', 'db:migrate'], 'migrate');
await run(['--filter', '@kanban/api', 'db:seed-if-empty'], 'seed');

const server = spawn('pnpm', ['--filter', '@kanban/api', 'start'], {
  cwd: root,
  env,
  stdio: 'inherit',
  shell: true,
});
server.on('exit', (code) => process.exit(code ?? 0));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.kill(signal));
