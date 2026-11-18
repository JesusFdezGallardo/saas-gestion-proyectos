import type {
  BoardEventEnvelope,
  BoardJoinAck,
  ClientToServerEvents,
  ServerToClientEvents,
  UserEvent,
} from '@kanban/shared';
import type { FastifyInstance } from 'fastify';
import { io as connectClient, type Socket as ClientSocket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { closeDb, systemDb } from '../src/db/client';
import { memberships } from '../src/db/schema';
import { RecordingTransport } from '../src/modules/mail/transport';
import { closeSocketServer, createSocketServer, SocketBus } from '../src/realtime/socket';
import { resetDb, signUp } from './helpers';

type Client = ClientSocket<ServerToClientEvents, ClientToServerEvents>;
type U = { cookie: string; userId: string; orgId: string };

const APP_ORIGIN = 'http://localhost:5173';
const WAIT_MS = 3000;

let app: FastifyInstance;
let bus: SocketBus;
let io: ReturnType<typeof createSocketServer>;
let baseUrl: string;
const clients: Client[] = [];

beforeAll(async () => {
  const config = loadConfig({ ...process.env, APP_ORIGIN, AUTH_RATE_LIMIT_MAX: '1000' });
  bus = new SocketBus();
  app = await buildApp({ config, bus, mail: new RecordingTransport(), logger: false });
  io = createSocketServer(app.server, { config, log: app.log });
  bus.attach(io);
  baseUrl = await app.listen({ port: 0, host: '127.0.0.1' });
});
beforeEach(async () => {
  await resetDb();
});
afterEach(() => {
  for (const c of clients.splice(0)) c.disconnect();
});
afterAll(async () => {
  closeSocketServer(io);
  await app.close();
  await closeDb();
});

/** Opens a client socket (not yet connected-checked) and tracks it for cleanup. */
function open(headers: Record<string, string> = {}): Client {
  const socket: Client = connectClient(baseUrl, {
    transports: ['websocket'],
    extraHeaders: headers,
    reconnection: false,
    forceNew: true,
  });
  clients.push(socket);
  return socket;
}

/** Resolves when connected; rejects with the server's error message on `connect_error`. */
function connected(socket: Client): Promise<void> {
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

async function connectAs(u: U): Promise<Client> {
  const socket = open({ cookie: u.cookie });
  await connected(socket);
  return socket;
}

function waitForEvent<E extends keyof ServerToClientEvents>(
  socket: Client,
  name: E,
  ms = WAIT_MS,
): Promise<Parameters<ServerToClientEvents[E]>[0]> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${name}`)), ms);
    const handler = ((payload: Parameters<ServerToClientEvents[E]>[0]) => {
      clearTimeout(timer);
      resolve(payload);
    }) as ServerToClientEvents[E];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    socket.once(name, handler as any);
  });
}

/** Records every `board:event` / `user:event` a socket receives. */
function record(socket: Client) {
  const board: BoardEventEnvelope[] = [];
  const user: UserEvent[] = [];
  socket.on('board:event', (e) => board.push(e));
  socket.on('user:event', (e) => user.push(e));
  return { board, user };
}

const join = (socket: Client, orgId: string, projectId: string): Promise<BoardJoinAck> =>
  socket.timeout(WAIT_MS).emitWithAck('board:join', { orgId, projectId });

/**
 * Round trip on `socket`'s own connection: anything the server emitted to it before this call
 * has been delivered once the ack arrives (same connection, in order). Replaces fixed sleeps
 * when asserting that an event did NOT arrive.
 */
const barrier = async (socket: Client): Promise<void> => {
  await join(
    socket,
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000000000',
  );
};

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';
const call = (
  method: Method,
  url: string,
  cookie: string,
  payload?: object,
  headers: Record<string, string> = {},
) => app.inject({ method, url, headers: { cookie, ...headers }, ...(payload ? { payload } : {}) });

async function mkBoard(u: U, orgId = u.orgId) {
  const p = (await call('POST', `/api/orgs/${orgId}/projects`, u.cookie, { name: 'P' })).json<{
    id: string;
  }>();
  const board = (await call('GET', `/api/orgs/${orgId}/projects/${p.id}/board`, u.cookie)).json<{
    columns: Array<{ id: string }>;
  }>();
  const cols = board.columns.map((c) => c.id);
  const card = (
    await call('POST', `/api/orgs/${orgId}/columns/${cols[0]}/cards`, u.cookie, { title: 'c' })
  ).json<{ id: string }>();
  return { projectId: p.id, cols, cardId: card.id };
}

/** Ana (admin of org A) and Luis (member of org A, admin of his own org). */
async function anaAndLuis() {
  const ana = await signUp(app, { email: 'ana@x.com', name: 'Ana', orgName: 'A' });
  const luis = await signUp(app, { email: 'luis@x.com', name: 'Luis', orgName: 'L' });
  await systemDb
    .insert(memberships)
    .values({ organizationId: ana.orgId, userId: luis.userId, role: 'member' });
  return { ana, luis };
}

const moveCard = (u: U, cardId: string, toColumnId: string, mutationId?: string) =>
  call(
    'POST',
    `/api/orgs/${u.orgId}/cards/${cardId}/move`,
    u.cookie,
    { toColumnId, beforeId: null, afterId: null },
    mutationId ? { 'x-client-mutation-id': mutationId } : {},
  );

describe('handshake', () => {
  it('connection without cookie fails with unauthenticated', async () => {
    await expect(connected(open())).rejects.toThrow('unauthenticated');
  });

  it('connection with an unknown session fails with unauthenticated', async () => {
    await expect(connected(open({ cookie: 'sid=not-a-session' }))).rejects.toThrow(
      'unauthenticated',
    );
  });

  it('rejects a handshake from another origin, accepts APP_ORIGIN', async () => {
    const ana = await signUp(app, { email: 'ana@x.com' });
    await expect(
      connected(open({ cookie: ana.cookie, origin: 'http://evil.example' })),
    ).rejects.toThrow();
    await expect(connected(open({ cookie: ana.cookie, origin: APP_ORIGIN }))).resolves.toBe(
      undefined,
    );
  });
});

describe('board:join', () => {
  it('joining a board of another org → ack {ok:false, code:"not_found"}', async () => {
    const ana = await signUp(app, { email: 'ana@x.com', orgName: 'A' });
    const eve = await signUp(app, { email: 'eve@x.com', orgName: 'E' });
    const { projectId } = await mkBoard(ana);
    const s = await connectAs(eve);
    expect(await join(s, ana.orgId, projectId)).toEqual({ ok: false, code: 'not_found' });
    // Own org id + a project that belongs to another org: also not found.
    expect(await join(s, eve.orgId, projectId)).toEqual({ ok: false, code: 'not_found' });
  });

  it('a non-member never receives events of a board it tried to join', async () => {
    const ana = await signUp(app, { email: 'ana@x.com', orgName: 'A' });
    const eve = await signUp(app, { email: 'eve@x.com', orgName: 'E' });
    const { projectId, cols, cardId } = await mkBoard(ana);
    const sa = await connectAs(ana);
    const se = await connectAs(eve);
    const got = record(se);
    expect(await join(sa, ana.orgId, projectId)).toEqual({ ok: true });
    await join(se, ana.orgId, projectId);
    const seen = waitForEvent(sa, 'board:event');
    expect((await moveCard(ana, cardId, cols[1]!)).statusCode).toBe(200);
    await seen;
    await barrier(se);
    expect(got.board).toEqual([]);
  });

  it('malformed payload → ack {ok:false, code:"validation"}', async () => {
    const ana = await signUp(app, { email: 'ana@x.com' });
    const s = await connectAs(ana);
    expect(await join(s, 'nope', 'nope')).toEqual({ ok: false, code: 'validation' });
  });
});

describe('board events', () => {
  it('Luis receives card.moved when Ana moves a card via REST', async () => {
    const { ana, luis } = await anaAndLuis();
    const { projectId, cols, cardId } = await mkBoard(ana);
    const sl = await connectAs(luis);
    expect(await join(sl, ana.orgId, projectId)).toEqual({ ok: true });
    const next = waitForEvent(sl, 'board:event');
    expect((await moveCard(ana, cardId, cols[2]!)).statusCode).toBe(200);
    const env = await next;
    expect(env.orgId).toBe(ana.orgId);
    expect(env.projectId).toBe(projectId);
    expect(env.event.type).toBe('card.moved');
    if (env.event.type !== 'card.moved') throw new Error('unreachable');
    expect(env.event.card).toMatchObject({ id: cardId, columnId: cols[2] });
    expect(env.event.meta.actorId).toBe(ana.userId);
  });

  it('event carries meta.clientMutationId sent by Ana', async () => {
    const { ana, luis } = await anaAndLuis();
    const { projectId, cols, cardId } = await mkBoard(ana);
    const sl = await connectAs(luis);
    await join(sl, ana.orgId, projectId);
    const next = waitForEvent(sl, 'board:event');
    await moveCard(ana, cardId, cols[1]!, 'mut-123');
    expect((await next).event.meta.clientMutationId).toBe('mut-123');
  });

  it('board:leave stops the events of that board', async () => {
    const { ana, luis } = await anaAndLuis();
    const { projectId, cols, cardId } = await mkBoard(ana);
    const sa = await connectAs(ana);
    const sl = await connectAs(luis);
    const got = record(sl);
    await join(sa, ana.orgId, projectId);
    await join(sl, ana.orgId, projectId);
    sl.emit('board:leave', { orgId: ana.orgId, projectId });
    await barrier(sl);
    const seen = waitForEvent(sa, 'board:event');
    await moveCard(ana, cardId, cols[1]!);
    await seen;
    await barrier(sl);
    expect(got.board).toEqual([]);
  });

  it('removed member stops receiving events of that org immediately', async () => {
    const { ana, luis } = await anaAndLuis();
    const b1 = await mkBoard(ana);
    const b2 = await mkBoard(ana);
    const own = await mkBoard(luis);
    const sa = await connectAs(ana);
    const sl = await connectAs(luis);
    const got = record(sl);
    await join(sa, ana.orgId, b1.projectId);
    expect(await join(sl, ana.orgId, b1.projectId)).toEqual({ ok: true });
    expect(await join(sl, ana.orgId, b2.projectId)).toEqual({ ok: true });
    expect(await join(sl, luis.orgId, own.projectId)).toEqual({ ok: true });

    const first = waitForEvent(sl, 'board:event');
    await moveCard(ana, b1.cardId, b1.cols[1]!);
    await first;
    expect(got.board).toHaveLength(1);

    const res = await call('DELETE', `/api/orgs/${ana.orgId}/members/${luis.userId}`, ana.cookie);
    expect(res.statusCode).toBe(204);

    // Right after the REST response: no more events from org A, on any of its boards.
    const seen = waitForEvent(sa, 'board:event');
    await moveCard(ana, b1.cardId, b1.cols[2]!);
    await seen;
    await moveCard(ana, b2.cardId, b2.cols[1]!);
    await barrier(sl);
    expect(got.board).toHaveLength(1);
    // Cannot join back, and his own org still works.
    expect(await join(sl, ana.orgId, b1.projectId)).toEqual({ ok: false, code: 'not_found' });
    const ownEvent = waitForEvent(sl, 'board:event');
    await moveCard(luis, own.cardId, own.cols[1]!);
    expect((await ownEvent).orgId).toBe(luis.orgId);
  });
});

describe('user and broadcast events', () => {
  it('notification sent toUser reaches only that user', async () => {
    const { ana, luis } = await anaAndLuis();
    const sa = await connectAs(ana);
    const sl = await connectAs(luis);
    const got = record(sl);
    const event: UserEvent = {
      type: 'notification.created',
      notification: {
        id: '11111111-1111-1111-1111-111111111111',
        orgId: ana.orgId,
        type: 'mention',
        actorId: luis.userId,
        cardId: '22222222-2222-2222-2222-222222222222',
        commentId: null,
        readAt: null,
        createdAt: new Date().toISOString(),
      },
      meta: { actorId: luis.userId },
    } as UserEvent;
    const received = waitForEvent(sa, 'user:event');
    bus.toUser(ana.userId, event);
    expect(await received).toEqual(event);
    await barrier(sl);
    expect(got.user).toEqual([]);
  });

  it('broadcast demo:reset reaches every connected socket', async () => {
    const { ana, luis } = await anaAndLuis();
    const sa = await connectAs(ana);
    const sl = await connectAs(luis);
    const both = Promise.all([waitForEvent(sa, 'demo:reset'), waitForEvent(sl, 'demo:reset')]);
    bus.broadcast('demo:reset');
    await expect(both).resolves.toHaveLength(2);
  });
});

describe('SocketBus before attach', () => {
  it('calls are no-ops', async () => {
    const detached = new SocketBus();
    detached.broadcast('demo:reset');
    await expect(detached.removeUserFromOrg('u', 'o')).resolves.toBeUndefined();
  });
});
