import type { CommentDto } from '@kanban/shared';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { toast } from '../../lib/toast';

export const commentsKey = (cardId: string) => ['comments', cardId] as const;

const byAge = (a: CommentDto, b: CommentDto) =>
  a.createdAt === b.createdAt ? a.id.localeCompare(b.id) : a.createdAt < b.createdAt ? -1 : 1;

/** Adds or replaces a comment in the cached list (idempotent: our own echo does no harm). */
export function upsertComment(
  list: CommentDto[] | undefined,
  c: CommentDto,
): CommentDto[] | undefined {
  if (!list) return list;
  const next = list.some((x) => x.id === c.id)
    ? list.map((x) => (x.id === c.id ? c : x))
    : [...list, c];
  return next.sort(byAge);
}

type CommentEvent =
  | { type: 'comment.created' | 'comment.updated'; comment: CommentDto }
  | { type: 'comment.deleted'; commentId: string; cardId: string };

/** A realtime `comment.*` event, applied to the card's cached list (only if it was loaded). */
export function applyCommentEvent(qc: QueryClient, e: CommentEvent): void {
  if (e.type === 'comment.deleted') {
    qc.setQueryData<CommentDto[]>(commentsKey(e.cardId), (list) =>
      list?.filter((c) => c.id !== e.commentId),
    );
  } else {
    qc.setQueryData<CommentDto[]>(commentsKey(e.comment.cardId), (list) =>
      upsertComment(list, e.comment),
    );
  }
}

export function useComments(orgId: string, cardId: string) {
  return useQuery({
    queryKey: commentsKey(cardId),
    queryFn: () => api<CommentDto[]>('GET', `/api/orgs/${orgId}/cards/${cardId}/comments`),
  });
}

/** Comment writes: REST, then the result into the cache. Failures show a toast and rethrow. */
export function useCommentActions(orgId: string, cardId: string) {
  const qc = useQueryClient();
  const base = `/api/orgs/${orgId}`;
  const fail = (err: unknown): never => {
    toast(errorMessage(err), 'error');
    throw err;
  };
  return {
    async create(body: string) {
      try {
        const c = await api<CommentDto>('POST', `${base}/cards/${cardId}/comments`, { body });
        qc.setQueryData<CommentDto[]>(commentsKey(cardId), (l) => upsertComment(l, c));
      } catch (err) {
        fail(err);
      }
    },
    async edit(commentId: string, body: string) {
      try {
        const c = await api<CommentDto>('PATCH', `${base}/comments/${commentId}`, { body });
        qc.setQueryData<CommentDto[]>(commentsKey(cardId), (l) => upsertComment(l, c));
      } catch (err) {
        fail(err);
      }
    },
    async remove(commentId: string) {
      try {
        await api('DELETE', `${base}/comments/${commentId}`);
        qc.setQueryData<CommentDto[]>(commentsKey(cardId), (l) =>
          l?.filter((c) => c.id !== commentId),
        );
      } catch (err) {
        fail(err);
      }
    },
  };
}
