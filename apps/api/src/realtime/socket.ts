import type { Server as HttpServer } from 'node:http';
import cookie from '@fastify/cookie';
import type {
  BoardEvent,
  BoardJoinAck,
  ClientToServerEvents,
  ServerToClientEvents,
  UserEvent,
} from '@kanban/shared';
import type { FastifyBaseLogger } from 'fastify';
import { Server, type Socket } from 'socket.io';
import { z } from 'zod';
import type { Config } from '../config';
import { SESSION_COOKIE } from '../http/auth-guard';
import { getSessionUser, type SessionUser } from '../modules/auth/service';
import { getMembershipRole } from '../modules/orgs/service';
import { projectInOrg } from '../modules/projects/service';
import type { RealtimeBus } from './bus';

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface InterServerEvents {}

interface SocketData {
  user: SessionUser;
}

export type IoServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;
type IoSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

export interface SocketDeps {
  config: Config;
  log: Pick<FastifyBaseLogger, 'error'>;
}

const userRoom = (userId: string): string => `user:${userId}`;
const orgPrefix = (orgId: string): string => `org:${orgId}:`;
const boardRoom = (orgId: string, projectId: string): string =>
  `${orgPrefix(orgId)}board:${projectId}`;

const BoardRef = z.object({ orgId: z.uuid(), projectId: z.uuid() });

/** Membership of the org and project-in-org, with the same check as the HTTP `requireOrg`. */
async function canSeeBoard(userId: string, orgId: string, projectId: string): Promise<boolean> {
  if (!(await getMembershipRole(userId, orgId))) return false;
  return projectInOrg(userId, orgId, projectId);
}

async function onBoardJoin(socket: IoSocket, payload: unknown): Promise<BoardJoinAck> {
  const parsed = BoardRef.safeParse(payload);
  if (!parsed.success) return { ok: false, code: 'validation' };
  const { orgId, projectId } = parsed.data;
  const userId = socket.data.user.id;
  if (!(await canSeeBoard(userId, orgId, projectId))) return { ok: false, code: 'not_found' };
  if (!socket.connected) return { ok: false, code: 'not_found' };
  const room = boardRoom(orgId, projectId);
  await socket.join(room);
  // Race with a concurrent removal: if `removeUserFromOrg` ran between the check and the join,
  // it did not see this room yet. Checking again after joining closes the gap: either this
  // check sees the deleted membership, or the removal (after its commit) sees the room.
  if (!(await getMembershipRole(userId, orgId))) {
    await socket.leave(room);
    return { ok: false, code: 'not_found' };
  }
  return { ok: true };
}

/**
 * Attaches Socket.IO to the HTTP server Fastify listens on (same origin as the SPA, so no CORS).
 *
 * Handshake: `Origin`, when present, must equal APP_ORIGIN (a missing one is only accepted
 * outside production, like the HTTP origin check); the `sid` cookie must be a live session, else
 * `connect_error` with message `unauthenticated`. Each socket joins `user:<userId>`.
 *
 * Board rooms (`org:<orgId>:board:<projectId>`) are joined only via `board:join`, after checking
 * membership and that the project belongs to that org. Sockets never write data.
 *
 * Session revocation: the session is checked at the handshake only. A socket whose session is
 * deleted later (logout elsewhere) stays connected until it reconnects, when the handshake fails.
 * Membership removal, by contrast, takes effect at once through `SocketBus.removeUserFromOrg`.
 */
export function createSocketServer(httpServer: HttpServer, deps: SocketDeps): IoServer {
  const { config, log } = deps;
  const allowedOrigin = new URL(config.appOrigin).origin;

  const io: IoServer = new Server(httpServer, {
    serveClient: false,
    // WebSocket only: HTTP long-polling is refused (no polling anywhere for board sync).
    transports: ['websocket'],
    allowRequest: (req, callback) => {
      const origin = req.headers.origin;
      if (origin === undefined) return callback(null, config.nodeEnv !== 'production');
      callback(null, origin === allowedOrigin);
    },
  });

  io.use((socket, next) => {
    const header = socket.handshake.headers.cookie;
    const token = header ? cookie.parse(header)[SESSION_COOKIE] : undefined;
    const fail = () =>
      next(Object.assign(new Error('unauthenticated'), { data: { code: 'unauthenticated' } }));
    if (!token) return fail();
    getSessionUser(token).then(
      (user) => {
        if (!user) return fail();
        socket.data.user = user;
        next();
      },
      (err: unknown) => {
        log.error({ err }, 'socket handshake failed');
        next(new Error('internal'));
      },
    );
  });

  io.on('connection', (socket) => {
    void socket.join(userRoom(socket.data.user.id));

    socket.on('board:join', (payload, ack) => {
      const reply = (r: BoardJoinAck) => {
        if (typeof ack === 'function') ack(r);
      };
      onBoardJoin(socket, payload).then(reply, (err: unknown) => {
        log.error({ err }, 'board:join failed');
        reply({ ok: false, code: 'not_found' });
      });
    });

    socket.on('board:leave', (payload) => {
      const parsed = BoardRef.safeParse(payload);
      if (parsed.success) void socket.leave(boardRoom(parsed.data.orgId, parsed.data.projectId));
    });
  });

  return io;
}

/** Disconnects every client and stops Socket.IO without closing the HTTP server (Fastify does). */
export function closeSocketServer(io: IoServer): void {
  io.disconnectSockets(true);
  io.engine.close();
}

/**
 * `RealtimeBus` over Socket.IO. Created unattached so it can be passed to `buildApp` before the
 * HTTP server exists; until `attach(io)` every call is a no-op.
 */
export class SocketBus implements RealtimeBus {
  private io: IoServer | undefined;

  attach(io: IoServer): void {
    this.io = io;
  }

  toBoard(orgId: string, projectId: string, event: BoardEvent): void {
    this.io?.to(boardRoom(orgId, projectId)).emit('board:event', { orgId, projectId, event });
  }

  toUser(userId: string, event: UserEvent): void {
    this.io?.to(userRoom(userId)).emit('user:event', event);
  }

  /** Single instance (in-memory adapter): every socket of the user leaves `org:<orgId>:*`. */
  async removeUserFromOrg(userId: string, orgId: string): Promise<void> {
    if (!this.io) return;
    const prefix = orgPrefix(orgId);
    const sockets = await this.io.in(userRoom(userId)).fetchSockets();
    const rooms = new Set<string>();
    for (const socket of sockets) {
      for (const room of socket.rooms) if (room.startsWith(prefix)) rooms.add(room);
    }
    // Through the adapter (not per-socket handles), so it also holds with a multi-node adapter.
    if (rooms.size > 0) this.io.in(userRoom(userId)).socketsLeave([...rooms]);
  }

  broadcast(event: 'demo:reset'): void {
    this.io?.emit(event);
  }
}
