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
