import type { BoardDto, BoardEvent, CardDto, ColumnDto } from '@kanban/shared';
import { describe, expect, it } from 'vitest';
import {
  applyEvent,
  applyOwnResult,
  type BoardEventBody,
  cardsInColumn,
  placeCard,
  placeColumn,
  sortedColumns,
} from '../src/features/board/applyEvent';

const meta = { actorId: 'u-other' };
const col = (id: string, position: string): ColumnDto => ({
  id,
  projectId: 'p1',
  name: id,
  position,
});
const card = (
  id: string,
  columnId: string,
  position: string,
  extra: Partial<CardDto> = {},
): CardDto => ({
  id,
  projectId: 'p1',
  columnId,
  title: id,
  description: '',
  assigneeId: null,
  dueDate: null,
  position,
  labelIds: [],
  createdBy: 'u1',
  commentCount: 0,
  ...extra,
});

function board(): BoardDto {
  return {
    project: { id: 'p1', name: 'Web', createdAt: '2026-11-18T00:00:00.000Z' },
    columns: [col('todo', 'a0'), col('doing', 'a1'), col('done', 'a2')],
    cards: [
      card('c1', 'todo', 'a0', { labelIds: ['l1', 'l2'] }),
      card('c2', 'todo', 'a1'),
      card('c3', 'doing', 'a0'),
      card('c4', 'doing', 'a2', { labelIds: ['l1'] }),
    ],
    labels: [
      { id: 'l1', projectId: 'p1', name: 'diseño', color: '#ef4444' },
      { id: 'l2', projectId: 'p1', name: 'api', color: '#3b82f6' },
    ],
    members: [{ userId: 'u1', name: 'Ana' }],
  };
}

const ids = (items: { id: string }[]) => items.map((c) => c.id);
const ev = (e: BoardEventBody): BoardEvent => ({ ...e, meta }) as BoardEvent;

describe('applyEvent', () => {
  it('card.moved moves card to new column and keeps order by position', () => {
    const b = board();
    const moved = { ...b.cards[0]!, columnId: 'doing', position: 'a1' };
    const next = applyEvent(b, ev({ type: 'card.moved', card: moved }));
    expect(ids(cardsInColumn(next, 'todo'))).toEqual(['c2']);
    expect(ids(cardsInColumn(next, 'doing'))).toEqual(['c3', 'c1', 'c4']);
    // Pure: the input is untouched.
    expect(ids(cardsInColumn(b, 'todo'))).toEqual(['c1', 'c2']);
  });

  it('orders by code unit with id tie-break, not by locale', () => {
    let b = applyEvent(board(), ev({ type: 'card.created', card: card('Zz', 'done', 'a0') }));
    b = applyEvent(b, ev({ type: 'card.created', card: card('aa', 'done', 'a0') }));
    b = applyEvent(b, ev({ type: 'card.created', card: card('c9', 'done', 'Zz') }));
    // 'Zz' < 'a0' bytewise ('Z' 0x5a < 'a' 0x61); the tie on 'a0' is broken by id.
    expect(ids(cardsInColumn(b, 'done'))).toEqual(['c9', 'Zz', 'aa']);
  });

  it('column.deleted moves movedCardIds into movedTo', () => {
    const next = applyEvent(
      board(),
      ev({
        type: 'column.deleted',
        columnId: 'todo',
        movedTo: 'doing',
        movedCardIds: ['c1', 'c2'],
      }),
    );
    expect(ids(sortedColumns(next))).toEqual(['doing', 'done']);
    // Appended after the target's last card, in the order given (same rule as the server).
    expect(ids(cardsInColumn(next, 'doing'))).toEqual(['c3', 'c4', 'c1', 'c2']);
    expect(next.cards.every((c) => c.columnId !== 'todo')).toBe(true);
  });

  it('column.deleted without movedTo drops the column', () => {
    const next = applyEvent(
      board(),
      ev({ type: 'column.deleted', columnId: 'done', movedCardIds: [] }),
    );
    expect(ids(sortedColumns(next))).toEqual(['todo', 'doing']);
    expect(next.cards).toHaveLength(4);
  });

  it('card.deleted removes card; unknown ids are ignored', () => {
    const b = board();
    const next = applyEvent(b, ev({ type: 'card.deleted', cardId: 'c2' }));
    expect(ids(next.cards)).not.toContain('c2');
    expect(applyEvent(b, ev({ type: 'card.deleted', cardId: 'nope' }))).toBe(b);
    expect(applyEvent(b, ev({ type: 'card.updated', card: card('nope', 'todo', 'a5') }))).toBe(b);
    expect(applyEvent(b, ev({ type: 'card.moved', card: card('nope', 'todo', 'a5') }))).toBe(b);
    expect(applyEvent(b, ev({ type: 'column.updated', column: col('nope', 'a9') }))).toBe(b);
    expect(applyEvent(b, ev({ type: 'column.deleted', columnId: 'nope', movedCardIds: [] }))).toBe(
      b,
    );
    expect(applyEvent(b, ev({ type: 'label.deleted', labelId: 'nope' }))).toBe(b);
    expect(applyEvent(b, ev({ type: 'label.updated', label: { ...b.labels[0]!, id: 'x' } }))).toBe(
      b,
    );
    // Another project's entities never land on this board.
    const foreign = { ...card('x', 'todo', 'a9'), projectId: 'p2' };
    expect(applyEvent(b, ev({ type: 'card.created', card: foreign }))).toBe(b);
    // A card in a column this board doesn't have is ignored too.
    expect(applyEvent(b, ev({ type: 'card.created', card: card('y', 'ghost', 'a0') }))).toBe(b);
  });

  it('card.created is idempotent (upsert) and card.updated replaces', () => {
    const c = card('c5', 'done', 'a0');
    const once = applyEvent(board(), ev({ type: 'card.created', card: c }));
    const twice = applyEvent(once, ev({ type: 'card.created', card: c }));
    expect(twice.cards.filter((x) => x.id === 'c5')).toHaveLength(1);
    const upd = applyEvent(
      twice,
      ev({ type: 'card.updated', card: { ...c, title: 'Nuevo', commentCount: 3 } }),
    );
    expect(upd.cards.find((x) => x.id === 'c5')).toMatchObject({ title: 'Nuevo', commentCount: 3 });
  });

  it('columns: created (upsert), updated (rename and reorder)', () => {
    let b = applyEvent(board(), ev({ type: 'column.created', column: col('qa', 'a3') }));
    b = applyEvent(b, ev({ type: 'column.created', column: col('qa', 'a3') }));
    expect(ids(sortedColumns(b))).toEqual(['todo', 'doing', 'done', 'qa']);
    b = applyEvent(b, ev({ type: 'column.updated', column: { ...col('qa', 'Zz'), name: 'QA' } }));
    expect(sortedColumns(b).map((c) => c.name)).toEqual(['QA', 'todo', 'doing', 'done']);
  });

  it('label.deleted strips the label from every card', () => {
    const next = applyEvent(board(), ev({ type: 'label.deleted', labelId: 'l1' }));
    expect(ids(next.labels)).toEqual(['l2']);
    expect(next.cards.find((c) => c.id === 'c1')!.labelIds).toEqual(['l2']);
    expect(next.cards.find((c) => c.id === 'c4')!.labelIds).toEqual([]);
  });

  it('labels, project.updated; comments and project.deleted leave the board alone', () => {
    const label = { id: 'l3', projectId: 'p1', name: 'x', color: '#22c55e' };
    let b = applyEvent(board(), ev({ type: 'label.created', label }));
    b = applyEvent(b, ev({ type: 'label.updated', label: { ...label, name: 'y' } }));
    expect(b.labels.find((l) => l.id === 'l3')!.name).toBe('y');
    b = applyEvent(b, ev({ type: 'project.updated', project: { ...b.project, name: 'Web 2' } }));
    expect(b.project.name).toBe('Web 2');
    expect(
      applyEvent(b, ev({ type: 'project.updated', project: { ...b.project, id: 'p2' } })),
    ).toBe(b);
    expect(applyEvent(b, ev({ type: 'project.deleted', projectId: 'p1' }))).toBe(b);
    expect(applyEvent(b, ev({ type: 'comment.deleted', commentId: 'k', cardId: 'c1' }))).toBe(b);
  });
});

describe('placeCard / placeColumn', () => {
  it('returns visual neighbours and a provisional position between them', () => {
    const r = placeCard(board(), 'c1', 'doing', 1); // between c3 and c4
    expect(r).toMatchObject({ beforeId: 'c3', afterId: 'c4' });
    expect(ids(cardsInColumn(r.board, 'doing'))).toEqual(['c3', 'c1', 'c4']);
    expect(ids(cardsInColumn(r.board, 'todo'))).toEqual(['c2']);
  });

  it('handles an empty column and the ends', () => {
    const b = board();
    const empty = placeCard(b, 'c1', 'done', 0);
    expect(empty).toMatchObject({ beforeId: null, afterId: null });
    expect(ids(cardsInColumn(empty.board, 'done'))).toEqual(['c1']);
    const top = placeCard(b, 'c4', 'todo', 0);
    expect(top).toMatchObject({ beforeId: null, afterId: 'c1' });
    expect(ids(cardsInColumn(top.board, 'todo'))).toEqual(['c4', 'c1', 'c2']);
    const sameColumnDown = placeCard(b, 'c1', 'todo', 1);
    expect(sameColumnDown).toMatchObject({ beforeId: 'c2', afterId: null });
    expect(ids(cardsInColumn(sameColumnDown.board, 'todo'))).toEqual(['c2', 'c1']);
  });

  it('reorders columns', () => {
    const r = placeColumn(board(), 'done', 0);
    expect(r).toMatchObject({ beforeId: null, afterId: 'todo' });
    expect(ids(sortedColumns(r.board))).toEqual(['done', 'todo', 'doing']);
  });
});

describe('applyOwnResult (response to this tab’s own write)', () => {
  it('applies the response when the entity is still what this tab left in the cache', () => {
    const placed = placeCard(board(), 'c1', 'doing', 1).board;
    const mine = placed.cards.find((c) => c.id === 'c1');
    const fromServer = { ...mine!, position: 'a1V' };
    const r = applyOwnResult(placed, mine, { type: 'card.moved', card: fromServer });
    expect(r.stale).toBe(false);
    expect(r.board.cards.find((c) => c.id === 'c1')).toEqual(fromServer);
  });

  it('remote event lands before the response: response ignored and resync requested', () => {
    const placed = placeCard(board(), 'c1', 'doing', 1).board;
    const mine = placed.cards.find((c) => c.id === 'c1');
    // Another user moved the same card after our write; their event arrives first.
    const remote = { ...mine!, columnId: 'done', position: 'a0' };
    const afterRemote = applyEvent(placed, ev({ type: 'card.moved', card: remote }));
    const ourResponse = { ...mine!, position: 'a1V' };
    const r = applyOwnResult(afterRemote, mine, { type: 'card.moved', card: ourResponse });
    expect(r.stale).toBe(true);
    expect(r.board).toBe(afterRemote);
    expect(r.board.cards.find((c) => c.id === 'c1')!.columnId).toBe('done');
  });

  it('same guard for columns and card updates; deleted meanwhile is stale too', () => {
    const b = board();
    const col = b.columns.find((c) => c.id === 'done');
    const renamed = applyEvent(
      b,
      ev({ type: 'column.updated', column: { ...col!, name: 'Remoto' } }),
    );
    const r = applyOwnResult(renamed, col, {
      type: 'column.updated',
      column: { ...col!, name: 'Mío' },
    });
    expect(r).toMatchObject({ stale: true });
    expect(r.board.columns.find((c) => c.id === 'done')!.name).toBe('Remoto');

    const card = b.cards.find((c) => c.id === 'c2');
    const gone = applyEvent(b, ev({ type: 'card.deleted', cardId: 'c2' }));
    const r2 = applyOwnResult(gone, card, { type: 'card.updated', card: { ...card!, title: 'x' } });
    expect(r2.stale).toBe(true);
    expect(gone.cards.some((c) => c.id === 'c2')).toBe(false);
  });

  it('without an expected entity (a create) it just applies', () => {
    const r = applyOwnResult(board(), undefined, {
      type: 'card.created',
      card: card('c9', 'done', 'a0'),
    });
    expect(r.stale).toBe(false);
    expect(ids(cardsInColumn(r.board, 'done'))).toEqual(['c9']);
  });
});
