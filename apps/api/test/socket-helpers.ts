import type { BoardJoinAck, ClientToServerEvents, ServerToClientEvents } from '@kanban/shared';
import type { FastifyInstance } from 'fastify';
import { io as connectClient, type Socket as ClientSocket } from 'socket.io-client';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { RecordingTransport } from '../src/modules/mail/transport';
import { createSocketServer, SocketBus } from '../src/realtime/socket';

export type Client = ClientSocket<ServerToClientEvents, ClientToServerEvents>;

export const WAIT_MS = 3000;

/** Opens a WebSocket-only client (no reconnection). The caller tracks it for cleanup. */
export function openSocket(baseUrl: string, headers: Record<string, string> = {}): Client {
  return connectClient(baseUrl, {
    transports: ['websocket'],
    extraHeaders: headers,
    reconnection: false,
    forceNew: true,
  });
}

/** Resolves when connected; rejects with the server's error message on `connect_error`. */
export function connected(socket: Client): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout waiting for connect')), WAIT_MS);
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once('connect_error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

export const joinBoard = (
  socket: Client,
  orgId: string,
  projectId: string,
): Promise<BoardJoinAck> => socket.timeout(WAIT_MS).emitWithAck('board:join', { orgId, projectId });

export interface RealtimeApp {
  app: FastifyInstance;
  bus: SocketBus;
  io: ReturnType<typeof createSocketServer>;
  baseUrl: string;
}

/** Real HTTP server (random port) with Socket.IO attached, for tests that connect sockets. */
export async function startRealtimeApp(
  overrides: Record<string, string> = {},
): Promise<RealtimeApp> {
  const config = loadConfig({ ...process.env, AUTH_RATE_LIMIT_MAX: '1000', ...overrides });
  const bus = new SocketBus();
  const app = await buildApp({ config, bus, mail: new RecordingTransport(), logger: false });
  const io = createSocketServer(app.server, { config, log: app.log });
  bus.attach(io);
  const baseUrl = await app.listen({ port: 0, host: '127.0.0.1' });
  return { app, bus, io, baseUrl };
}
