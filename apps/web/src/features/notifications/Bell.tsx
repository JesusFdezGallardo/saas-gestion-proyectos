import type { NotificationDto } from '@kanban/shared';
import { useCallback, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { relativeTime } from '../../lib/time';
import { useDismiss } from '../../lib/useDismiss';
import {
  notificationPath,
  notificationText,
  useMarkRead,
  useNotificationList,
  useNotificationsRealtime,
  useUnreadCount,
} from './useNotifications';

/** Bell with the unread badge and the dropdown list of notifications. */
export function Bell() {
  useNotificationsRealtime();
  const navigate = useNavigate();
  const panelId = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const { data: unread = 0 } = useUnreadCount();
  const list = useNotificationList(open);
  const mark = useMarkRead();
  const close = useCallback(() => {
    setOpen(false);
    trigger.current?.focus();
  }, []);
  useDismiss(open, root, close);

  const items = list.data?.pages.flat() ?? [];

  function choose(n: NotificationDto) {
    void mark.one(n);
    setOpen(false);
    navigate(notificationPath(n));
  }

  return (
    <div ref={root} className="relative">
      <button
        ref={trigger}
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={unread > 0 ? `Notificaciones, ${unread} sin leer` : 'Notificaciones'}
        onClick={() => setOpen((o) => !o)}
        className="relative flex min-h-9 min-w-9 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="h-5 w-5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.7 21a2 2 0 0 1-3.4 0" />
        </svg>
        {unread > 0 && (
          <span
            aria-hidden="true"
            data-testid="bell-badge"
            className="absolute -top-0.5 -right-0.5 min-w-4 rounded-full bg-red-600 px-1 text-center text-[10px] leading-4 font-semibold text-white"
          >
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div
          id={panelId}
          role="region"
          aria-label="Notificaciones"
          className="absolute right-0 z-30 mt-2 w-96 max-w-[calc(100vw-2rem)] rounded-lg border border-slate-200 bg-white shadow-xl"
        >
          <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
            <h2 className="text-sm font-semibold">Notificaciones</h2>
            <button
              type="button"
              disabled={unread === 0}
              onClick={() => void mark.all()}
              className="min-h-8 rounded px-2 text-sm text-accent-700 hover:bg-accent-50 disabled:text-slate-400 disabled:hover:bg-transparent"
            >
              Marcar todas como leídas
            </button>
          </div>
          <div className="max-h-96 overflow-y-auto">
            {list.isPending ? (
              <p role="status" className="p-4 text-center text-sm text-slate-500">
                Cargando…
              </p>
            ) : list.isError ? (
              <p role="alert" className="p-4 text-center text-sm text-red-700">
                No se han podido cargar las notificaciones.
              </p>
            ) : items.length === 0 ? (
              <p className="p-4 text-center text-sm text-slate-500">No tienes notificaciones.</p>
            ) : (
              <ul>
                {items.map((n) => (
                  <li key={n.id} className="border-b border-slate-100 last:border-b-0">
                    <button
                      type="button"
                      onClick={() => choose(n)}
                      className={`flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50 ${
                        n.readAt ? 'text-slate-600' : 'bg-accent-50 font-medium text-slate-900'
                      }`}
                    >
                      <span
                        aria-hidden="true"
                        className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                          n.readAt ? 'bg-transparent' : 'bg-accent-600'
                        }`}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block break-words">{notificationText(n)}</span>
                        <span className="block text-xs font-normal text-slate-500">
                          {relativeTime(n.createdAt)}
                          {n.readAt ? '' : ' · sin leer'}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {list.hasNextPage && (
              <div className="p-2 text-center">
                <button
                  type="button"
                  disabled={list.isFetchingNextPage}
                  onClick={() => void list.fetchNextPage()}
                  className="min-h-9 rounded px-3 text-sm text-accent-700 hover:bg-accent-50 disabled:text-slate-400"
                >
                  {list.isFetchingNextPage ? 'Cargando…' : 'Cargar más'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
