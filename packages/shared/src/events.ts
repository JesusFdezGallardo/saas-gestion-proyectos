import type { ErrorCode } from './errors';
import type {
  CardDto,
  ColumnDto,
  CommentDto,
  LabelDto,
  NotificationDto,
  ProjectDto,
} from './schemas';

export interface EventMeta {
  actorId: string;
  clientMutationId?: string;
}

type WithMeta<T> = T & { meta: EventMeta };

export type BoardEvent = WithMeta<
  | { type: 'column.created'; column: ColumnDto }
  | { type: 'column.updated'; column: ColumnDto }
  | { type: 'column.deleted'; columnId: string; movedTo?: string; movedCardIds: string[] }
  | { type: 'card.created'; card: CardDto }
  | { type: 'card.updated'; card: CardDto }
  | { type: 'card.moved'; card: CardDto }
  | { type: 'card.deleted'; cardId: string }
  | { type: 'label.created'; label: LabelDto }
  | { type: 'label.updated'; label: LabelDto }
  | { type: 'label.deleted'; labelId: string }
  | { type: 'comment.created'; comment: CommentDto }
  | { type: 'comment.updated'; comment: CommentDto }
  | { type: 'comment.deleted'; commentId: string; cardId: string }
  | { type: 'project.updated'; project: ProjectDto }
  | { type: 'project.deleted'; projectId: string }
>;

export type UserEvent = WithMeta<{ type: 'notification.created'; notification: NotificationDto }>;

/** What the server emits on `board:event`: the event plus the board it belongs to. */
export interface BoardEventEnvelope {
  orgId: string;
  projectId: string;
  event: BoardEvent;
}

export interface BoardRef {
  orgId: string;
  projectId: string;
}

export type BoardJoinAck = { ok: true } | { ok: false; code: ErrorCode };

/** Socket.IO events the server sends. */
export interface ServerToClientEvents {
  /** Sent to room `org:<orgId>:board:<projectId>`. */
  'board:event': (envelope: BoardEventEnvelope) => void;
  /** Sent to room `user:<userId>`. */
  'user:event': (event: UserEvent) => void;
  /** Sent to everyone: the demo data was reset, refetch everything. */
  'demo:reset': () => void;
}

/** Socket.IO events the client may send (writes always go through REST). */
export interface ClientToServerEvents {
  'board:join': (board: BoardRef, ack: (result: BoardJoinAck) => void) => void;
  'board:leave': (board: BoardRef) => void;
}
