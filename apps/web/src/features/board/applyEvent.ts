import {
  comparePositions,
  positionBetween,
  type BoardDto,
  type BoardEvent,
  type CardDto,
  type ColumnDto,
} from '@kanban/shared';

/** A board event without `meta` (distributes over the union, unlike a plain `Omit`). */
export type BoardEventBody = BoardEvent extends infer E
  ? E extends BoardEvent
    ? Omit<E, 'meta'>
    : never
  : never;

/** Columns in board order. */
export function sortedColumns(board: BoardDto): ColumnDto[] {
  return [...board.columns].sort(comparePositions);
}

/** Cards of one column in board order. */
export function cardsInColumn(board: BoardDto, columnId: string): CardDto[] {
  return board.cards.filter((c) => c.columnId === columnId).sort(comparePositions);
}

/** Key strictly between two neighbours; falls back to "after `before`" if they are out of order. */
function between(before: string | null, after: string | null): string {
  if (before !== null && after !== null && before >= after) return positionBetween(before, null);
  return positionBetween(before, after);
}

function upsert<T extends { id: string }>(list: T[], item: T): T[] {
  const i = list.findIndex((x) => x.id === item.id);
  if (i < 0) return [...list, item];
  const next = [...list];
  next[i] = item;
  return next;
}

function replaceIfPresent<T extends { id: string }>(list: T[], item: T): T[] | null {
  return list.some((x) => x.id === item.id) ? upsert(list, item) : null;
}

/**
 * Applies a realtime event to a cached board. Pure: returns a new board, or the same object when
 * the event doesn't concern this board (other project, unknown ids, comments).
 */
export function applyEvent(board: BoardDto, e: BoardEvent): BoardDto {
  const projectId = board.project.id;
  const hasColumn = (id: string) => board.columns.some((c) => c.id === id);

  switch (e.type) {
    case 'project.updated':
      return e.project.id === projectId ? { ...board, project: e.project } : board;
    case 'project.deleted':
      // Handled by the realtime hook (leave the page); nothing to change in the cache.
      return board;

    case 'column.created':
      if (e.column.projectId !== projectId) return board;
      return { ...board, columns: upsert(board.columns, e.column) };
    case 'column.updated': {
      if (e.column.projectId !== projectId) return board;
      const columns = replaceIfPresent(board.columns, e.column);
      return columns ? { ...board, columns } : board;
    }
    case 'column.deleted': {
      if (!hasColumn(e.columnId)) return board;
      const columns = board.columns.filter((c) => c.id !== e.columnId);
      let cards = board.cards;
      if (e.movedTo && hasColumn(e.movedTo)) {
        // Same rule as the server: appended after the target's last card, in the given order.
        let prev = cardsInColumn(board, e.movedTo).at(-1)?.position ?? null;
        const newPos = new Map<string, string>();
        for (const id of e.movedCardIds) {
          prev = positionBetween(prev, null);
          newPos.set(id, prev);
        }
        const target = e.movedTo;
        cards = cards.map((c) => {
          const position = newPos.get(c.id);
          return position === undefined ? c : { ...c, columnId: target, position };
        });
      }
      // Anything still pointing at the deleted column is stale: drop it (a refetch will fix it).
      cards = cards.filter((c) => c.columnId !== e.columnId);
      return { ...board, columns, cards };
    }

    case 'card.created':
      if (e.card.projectId !== projectId || !hasColumn(e.card.columnId)) return board;
      return { ...board, cards: upsert(board.cards, e.card) };
    case 'card.updated':
    case 'card.moved': {
      if (e.card.projectId !== projectId || !hasColumn(e.card.columnId)) return board;
      const cards = replaceIfPresent(board.cards, e.card);
      return cards ? { ...board, cards } : board;
    }
    case 'card.deleted': {
      if (!board.cards.some((c) => c.id === e.cardId)) return board;
      return { ...board, cards: board.cards.filter((c) => c.id !== e.cardId) };
    }

    case 'label.created':
      if (e.label.projectId !== projectId) return board;
      return { ...board, labels: upsert(board.labels, e.label) };
    case 'label.updated': {
      if (e.label.projectId !== projectId) return board;
      const labels = replaceIfPresent(board.labels, e.label);
      return labels ? { ...board, labels } : board;
    }
    case 'label.deleted': {
      if (!board.labels.some((l) => l.id === e.labelId)) return board;
      return {
        ...board,
        labels: board.labels.filter((l) => l.id !== e.labelId),
        cards: board.cards.map((c) =>
          c.labelIds.includes(e.labelId)
            ? { ...c, labelIds: c.labelIds.filter((id) => id !== e.labelId) }
            : c,
        ),
      };
    }

    case 'comment.created':
    case 'comment.updated':
    case 'comment.deleted':
      // The comment count arrives as `card.updated`; the thread itself is Task 14's.
      return board;
    default: {
      const unknown: never = e;
      void unknown;
      return board;
    }
  }
}

export interface Placement {
  board: BoardDto;
  /** The item that ends up just before (above / left of) the moved one. */
  beforeId: string | null;
  /** The item that ends up just after it. */
  afterId: string | null;
}

/**
 * Puts a card at `index` of `toColumnId` (index among the other cards of that column) with a
 * provisional position between its new visual neighbours. Returns the board unchanged if the card
 * or the column is gone.
 */
export function placeCard(
  board: BoardDto,
  cardId: string,
  toColumnId: string,
  index: number,
): Placement {
  const card = board.cards.find((c) => c.id === cardId);
  if (!card || !board.columns.some((c) => c.id === toColumnId)) {
    return { board, beforeId: null, afterId: null };
  }
  const others = cardsInColumn(board, toColumnId).filter((c) => c.id !== cardId);
  const i = Math.max(0, Math.min(index, others.length));
  const before = others[i - 1] ?? null;
  const after = others[i] ?? null;
  const position = between(before?.position ?? null, after?.position ?? null);
  return {
    board: { ...board, cards: upsert(board.cards, { ...card, columnId: toColumnId, position }) },
    beforeId: before?.id ?? null,
    afterId: after?.id ?? null,
  };
}

/** Same as `placeCard` for a column at `index` among the other columns. */
export function placeColumn(board: BoardDto, columnId: string, index: number): Placement {
  const column = board.columns.find((c) => c.id === columnId);
  if (!column) return { board, beforeId: null, afterId: null };
  const others = sortedColumns(board).filter((c) => c.id !== columnId);
  const i = Math.max(0, Math.min(index, others.length));
  const before = others[i - 1] ?? null;
  const after = others[i] ?? null;
  const position = between(before?.position ?? null, after?.position ?? null);
  return {
    board: { ...board, columns: upsert(board.columns, { ...column, position }) },
    beforeId: before?.id ?? null,
    afterId: after?.id ?? null,
  };
}
