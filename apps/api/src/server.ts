import { buildApp } from './app';
import { loadConfig } from './config';
import { closeDb } from './db/client';
import { NullTransport } from './modules/mail/transport';
import { NoopBus } from './realtime/bus';

const config = loadConfig(process.env);

// Socket.IO (Task 7) and the real mail transports (Task 12) replace these two.
const app = await buildApp({ config, bus: new NoopBus(), mail: new NullTransport() });

async function shutdown(): Promise<void> {
  await app.close();
  await closeDb();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());

await app.listen({ port: config.port, host: '0.0.0.0' });
