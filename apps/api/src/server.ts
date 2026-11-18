import { buildApp } from './app';
import { loadConfig } from './config';
import { closeDb } from './db/client';
import { installQueue } from './modules/mail/queue';
import { createTransport } from './modules/mail/transport';
import { startEmailWorker } from './modules/mail/worker';
import { closeSocketServer, createSocketServer, SocketBus } from './realtime/socket';

const config = loadConfig(process.env);

const bus = new SocketBus();
const mail = createTransport(config);
const app = await buildApp({ config, bus, mail });
const io = createSocketServer(app.server, { config, log: app.log });
bus.attach(io);

// Email queue and worker run in this same process (no second service on the free plan).
// installQueue is idempotent; at start it also covers a pg-boss upgrade since the last migrate.
await installQueue(config.databaseUrlOwner);
await startEmailWorker({
  transport: mail,
  deliver: config.mailTransport !== 'none',
  appOrigin: config.appOrigin,
  unsubscribeSecret: config.unsubscribeSecret,
  log: app.log,
});
app.log.info({ mailTransport: config.mailTransport }, 'email worker started');

async function shutdown(): Promise<void> {
  closeSocketServer(io);
  await app.close();
  await closeDb(); // also stops the job queue (onCloseDb hook)
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());

await app.listen({ port: config.port, host: '0.0.0.0' });
