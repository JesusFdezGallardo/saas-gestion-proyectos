import type { NotificationDto, UserEvent } from '@kanban/shared';
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from '@tanstack/react-query';
import { useEffect } from 'react';
import { api } from '../../lib/api';
import { getSocket } from '../../lib/socket';
import { toast } from '../../lib/toast';
import { errorMessage } from '../../lib/errors';
import { mailboxKey } from '../mailbox/MailboxPage';

export const PAGE_SIZE = 20;
export const countKey = ['notifications', 'count'] as const;
export const listKey = ['notifications', 'list'] as const;

type Pages = InfiniteData<NotificationDto[], string | null>;

/** Spanish sentence for a notification. */
export function notificationText(n: NotificationDto): string {
  const verb = { mention: 'te mencionó en', assigned: 'te asignó', comment: 'comentó en' }[n.type];
  return `${n.actorName} ${verb} «${n.cardTitle}»`;
}

export function notificationPath(n: NotificationDto): string {
  return `/o/${n.orgId}/p/${n.projectId}?card=${n.cardId}`;
}

/** Cursor for `?before=`: the last item's date and id. */
const cursorOf = (page: NotificationDto[]): string | undefined => {
  const last = page.at(-1);
  return page.length >= PAGE_SIZE && last ? `${last.createdAt}|${last.id}` : undefined;
};

export function useUnreadCount() {
  return useQuery({
    queryKey: countKey,
    queryFn: async () =>
      (await api<{ count: number }>('GET', '/api/notifications/unread-count')).count,
  });
}

/** The bell's list, loaded on demand (`enabled`), one cursor page at a time. */
export function useNotificationList(enabled: boolean) {
  return useInfiniteQuery({
    queryKey: listKey,
    enabled,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api<NotificationDto[]>(
        'GET',
        `/api/notifications${pageParam ? `?before=${encodeURIComponent(pageParam)}` : ''}`,
      ),
    getNextPageParam: (last) => cursorOf(last) ?? null,
  });
}

/** A new notification from the socket: on top of the list, one more unread. */
export function applyNotificationCreated(qc: QueryClient, n: NotificationDto): void {
  let known = false;
  qc.setQueryData<Pages>(listKey, (data) => {
    if (!data) return data;
    known = data.pages.some((p) => p.some((x) => x.id === n.id));
    if (known) return data;
    const [first = [], ...rest] = data.pages;
    return { ...data, pages: [[n, ...first], ...rest] };
  });
  if (known) return;
  if (qc.getQueryData<number>(countKey) === undefined) {
    void qc.invalidateQueries({ queryKey: countKey });
  } else if (n.readAt === null) {
    qc.setQueryData<number>(countKey, (c) => (c ?? 0) + 1);
  }
}

/**
 * Keeps the bell and the mailbox live: `notification.created` on the user's socket room updates
 * both; on the first connect they are refetched (events may have been missed meanwhile).
 */
export function useNotificationsRealtime(): void {
  const qc = useQueryClient();
  useEffect(() => {
    const socket = getSocket();
    const onEvent = (event: UserEvent) => {
      if (event.type !== 'notification.created') return;
      applyNotificationCreated(qc, event.notification);
      // The email usually lands a moment later: the mailbox also refetches on focus.
      void qc.invalidateQueries({ queryKey: mailboxKey });
    };
    // First connection only (events between the first fetch and joining the room): later
    // reconnections are refetched by useDemoRecovery, together with the session check.
    let first = true;
    const onConnect = () => {
      if (!first) return;
      first = false;
      void qc.invalidateQueries({ queryKey: ['notifications'] });
      void qc.invalidateQueries({ queryKey: mailboxKey });
    };
    socket.on('user:event', onEvent);
    socket.on('connect', onConnect);
    return () => {
      socket.off('user:event', onEvent);
      socket.off('connect', onConnect);
    };
  }, [qc]);
}

/** Marks one or all notifications as read, in the cache and on the server. */
export function useMarkRead() {
  const qc = useQueryClient();
  const refresh = () => void qc.invalidateQueries({ queryKey: countKey });
  return {
    async one(n: NotificationDto): Promise<void> {
      if (n.readAt) return;
      try {
        const updated = await api<NotificationDto>('POST', `/api/notifications/${n.id}/read`);
        qc.setQueryData<Pages>(
          listKey,
          (data) =>
            data && {
              ...data,
              pages: data.pages.map((p) => p.map((x) => (x.id === n.id ? updated : x))),
            },
        );
        qc.setQueryData<number>(countKey, (c) => (c === undefined ? c : Math.max(0, c - 1)));
      } catch (err) {
        toast(errorMessage(err), 'error');
      } finally {
        refresh();
      }
    },
    async all(): Promise<void> {
      try {
        await api('POST', '/api/notifications/read-all');
        const readAt = new Date().toISOString();
        qc.setQueryData<Pages>(
          listKey,
          (data) =>
            data && {
              ...data,
              pages: data.pages.map((p) => p.map((x) => (x.readAt ? x : { ...x, readAt }))),
            },
        );
        qc.setQueryData<number>(countKey, 0);
      } catch (err) {
        toast(errorMessage(err), 'error');
      } finally {
        refresh();
      }
    },
  };
}
