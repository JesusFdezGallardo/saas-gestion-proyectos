import { buildApp } from './app';
import { loadConfig } from './config';
import { closeDb } from './db/client';
import { NullTransport } from './modules/mail/transport';
import { closeSocketServer, createSocketServer, SocketBus } from './realtime/socket';

const config = loadConfig(process.env);

// The real mail transports (Task 12) replace NullTransport.
const bus = new SocketBus();
const app = await buildApp({ config, bus, mail: new NullTransport() });
const io = createSocketServer(app.server, { config, log: app.log });
bus.attach(io);

async function shutdown(): Promise<void> {
  closeSocketServer(io);
  await app.close();
  await closeDb();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());

await app.listen({ port: config.port, host: '0.0.0.0' });
