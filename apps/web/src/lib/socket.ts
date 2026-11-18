import type { ClientToServerEvents, ServerToClientEvents } from '@kanban/shared';
import { io, type Socket } from 'socket.io-client';

export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: AppSocket | undefined;

/** One shared socket; connects on first use. The server only accepts the WebSocket transport. */
export function getSocket(): AppSocket {
  if (!socket) {
    socket = io({ transports: ['websocket'], withCredentials: true, autoConnect: false });
  }
  if (socket.disconnected && !socket.active) socket.connect();
  return socket;
}

export function closeSocket(): void {
  socket?.disconnect();
  socket = undefined;
}
