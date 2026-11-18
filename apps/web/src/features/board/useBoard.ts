import type {
  BoardDto,
  BoardEvent,
  CardDto,
  ColumnDto,
  CreateLabelInput,
  LabelDto,
  UpdateCardInput,
  UpdateLabelInput,
} from '@kanban/shared';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { api } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { toast } from '../../lib/toast';
import {
  applyEvent,
  applyOwnResult,
  cardsInColumn,
  placeCard,
  placeColumn,
  type BoardEventBody,
} from './applyEvent';
import { forgetMutation, trackMutation } from './pending';

export const boardKey = (projectId: string) => ['board', projectId] as const;

export function useBoard(orgId: string, projectId: string) {
  return useQuery({
    queryKey: boardKey(projectId),
    queryFn: () => api<BoardDto>('GET', `/api/orgs/${orgId}/projects/${projectId}/board`),
  });
}

/** Every board write: REST with a tracked `clientMutationId`, then the result into the cache. */
export function useBoardActions(orgId: string, projectId: string) {
  const qc = useQueryClient();
  return useMemo(() => createActions(qc, orgId, projectId), [qc, orgId, projectId]);
}

export type BoardActions = ReturnType<typeof createActions>;

function createActions(qc: QueryClient, orgId: string, projectId: string) {
  const key = boardKey(projectId);
  const base = `/api/orgs/${orgId}`;
  const get = () => qc.getQueryData<BoardDto>(key);
  const set = (fn: (b: BoardDto) => BoardDto) =>
    qc.setQueryData<BoardDto>(key, (b) => (b ? fn(b) : b));
  // What this tab already knows locally goes into the cache like a remote event would.
  const apply = (e: BoardEventBody) =>
    set((b) => applyEvent(b, { ...e, meta: { actorId: '' } } as BoardEvent));
  const resync = () => void qc.invalidateQueries({ queryKey: key });
  /**
   * The response to our own write, applied only if the entity is still `expected` (the object
   * this tab last saw or left in the cache). A remote event that arrived meanwhile may be newer
   * than our write, and our own echo is skipped, so in that case keep the cache and refetch.
   */
  const applyOwn = (expected: object | undefined, e: BoardEventBody) => {
    let stale = false;
    set((b) => {
      const r = applyOwnResult(b, expected, e);
      stale = r.stale;
      return r.board;
    });
    if (stale) resync();
  };
  const cardInCache = (id: string) => get()?.cards.find((c) => c.id === id);
  const columnInCache = (id: string) => get()?.columns.find((c) => c.id === id);

  /** Sends one write; on failure shows `failText` (or the API's reason) and rethrows. */
  async function send<T>(
    method: string,
    path: string,
    body: unknown,
    failText?: string,
  ): Promise<T> {
    const mutationId = trackMutation();
    try {
      return await api<T>(method, path, body, { mutationId });
    } catch (err) {
      forgetMutation(mutationId);
      toast(failText ?? errorMessage(err), 'error');
      throw err;
    }
  }

  return {
    async createColumn(name: string) {
      const column = await send<ColumnDto>('POST', `${base}/projects/${projectId}/columns`, {
        name,
      });
      apply({ type: 'column.created', column });
    },

    async renameColumn(columnId: string, name: string) {
      const expected = columnInCache(columnId);
      const column = await send<ColumnDto>('PATCH', `${base}/columns/${columnId}`, { name });
      applyOwn(expected, { type: 'column.updated', column });
    },

    /** Optimistic: the column jumps to `index` at once; restored if the API refuses. */
    async moveColumn(columnId: string, index: number) {
      const board = get();
      const before = board?.columns.find((c) => c.id === columnId);
      if (!board || !before) return;
      const placed = placeColumn(board, columnId, index);
      qc.setQueryData(key, placed.board);
      // Read back: the cache may hold a structurally shared copy, not `placed.board`'s object.
      const provisional = columnInCache(columnId);
      try {
        const column = await send<ColumnDto>(
          'PATCH',
          `${base}/columns/${columnId}`,
          { beforeId: placed.beforeId, afterId: placed.afterId },
          'No se pudo mover la columna',
        );
        applyOwn(provisional, { type: 'column.updated', column });
      } catch {
        // Put back only this column, and only if no remote change replaced it meanwhile.
        set((b) => ({
          ...b,
          columns: b.columns.map((c) =>
            c.id === columnId && c === provisional ? { ...c, position: before.position } : c,
          ),
        }));
        resync();
      }
    },

    async deleteColumn(columnId: string, moveTo?: string) {
      const query = moveTo ? `?moveTo=${encodeURIComponent(moveTo)}` : '';
      await send<void>('DELETE', `${base}/columns/${columnId}${query}`, undefined);
      // The column's cards as the cache has them *now* (a remote card may have arrived meanwhile).
      set((b) =>
        applyEvent(b, {
          type: 'column.deleted',
          columnId,
          movedCardIds: moveTo ? cardsInColumn(b, columnId).map((c) => c.id) : [],
          ...(moveTo ? { movedTo: moveTo } : {}),
          meta: { actorId: '' },
        }),
      );
      // Moved cards got server positions we only approximate, and a card created in the column
      // just before the delete may not have reached us: take the server's word for it.
      if (moveTo) resync();
    },

    async createCard(columnId: string, title: string) {
      const card = await send<CardDto>('POST', `${base}/columns/${columnId}/cards`, { title });
      apply({ type: 'card.created', card });
      return card;
    },

    async updateCard(cardId: string, patch: UpdateCardInput) {
      const expected = cardInCache(cardId);
      const card = await send<CardDto>('PATCH', `${base}/cards/${cardId}`, patch);
      applyOwn(expected, { type: 'card.updated', card });
      return card;
    },

    /**
     * Optimistic move to `index` of `toColumnId`: provisional position between the visual
     * neighbours, then `/move`; the server's card replaces it, or the old place is restored.
     */
    async moveCard(cardId: string, toColumnId: string, index: number) {
      const board = get();
      const snapshot = board?.cards.find((c) => c.id === cardId);
      if (!board || !snapshot) return;
      const placed = placeCard(board, cardId, toColumnId, index);
      qc.setQueryData(key, placed.board);
      const provisional = cardInCache(cardId);
      try {
        const card = await send<CardDto>(
          'POST',
          `${base}/cards/${cardId}/move`,
          { toColumnId, beforeId: placed.beforeId, afterId: placed.afterId },
          'No se pudo mover la tarjeta',
        );
        applyOwn(provisional, { type: 'card.moved', card });
      } catch {
        set((b) => ({
          ...b,
          cards: b.cards.map((c) =>
            c.id === cardId && c === provisional
              ? { ...c, columnId: snapshot.columnId, position: snapshot.position }
              : c,
          ),
        }));
        resync();
      }
    },

    async deleteCard(cardId: string) {
      await send<void>('DELETE', `${base}/cards/${cardId}`, undefined);
      apply({ type: 'card.deleted', cardId });
    },

    async createLabel(input: CreateLabelInput) {
      const label = await send<LabelDto>('POST', `${base}/projects/${projectId}/labels`, input);
      apply({ type: 'label.created', label });
    },

    async updateLabel(labelId: string, input: UpdateLabelInput) {
      const expected = get()?.labels.find((l) => l.id === labelId);
      const label = await send<LabelDto>('PATCH', `${base}/labels/${labelId}`, input);
      applyOwn(expected, { type: 'label.updated', label });
    },

    async deleteLabel(labelId: string) {
      await send<void>('DELETE', `${base}/labels/${labelId}`, undefined);
      apply({ type: 'label.deleted', labelId });
    },
  };
}
