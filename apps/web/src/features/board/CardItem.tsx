import type { CardDto, LabelDto } from '@kanban/shared';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { KeyboardEvent } from 'react';

export interface CardLookups {
  labels: Map<string, LabelDto>;
  members: Map<string, string>;
}

const initials = (name: string) =>
  name
    .split(/\s+/u)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');

/** `YYYY-MM-DD` as a local date (not UTC midnight, which can show the previous day). */
function parseDay(day: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y!, m! - 1, d!);
}

function DueDate({ day }: { day: string }) {
  const date = parseDay(day);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const overdue = date < today;
  const text = date.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-xs ${
        overdue ? 'bg-red-100 text-red-800' : 'bg-slate-100 text-slate-700'
      }`}
      title={overdue ? 'Fecha límite pasada' : 'Fecha límite'}
    >
      <span className="sr-only">{overdue ? 'Vencida: ' : 'Fecha límite: '}</span>
      {text}
    </span>
  );
}

/** What a card looks like, without drag behaviour (also used in the drag overlay). */
export function CardFace({ card, lookups }: { card: CardDto; lookups: CardLookups }) {
  const labels = card.labelIds.map((id) => lookups.labels.get(id)).filter((l) => l !== undefined);
  const assignee = card.assigneeId ? lookups.members.get(card.assigneeId) : undefined;
  return (
    <>
      {labels.length > 0 && (
        <span className="mb-1.5 flex flex-wrap gap-1">
          {labels.map((l) => (
            <span
              key={l.id}
              className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700"
            >
              <span
                aria-hidden="true"
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: l.color }}
              />
              {l.name}
            </span>
          ))}
        </span>
      )}
      <span className="block text-sm font-medium break-words whitespace-pre-wrap text-slate-900">
        {card.title}
      </span>
      {(card.dueDate || assignee || card.commentCount > 0) && (
        <span className="mt-2 flex items-center gap-2">
          {card.dueDate && <DueDate day={card.dueDate} />}
          {card.commentCount > 0 && (
            <span className="text-xs text-slate-500">
              {card.commentCount} {card.commentCount === 1 ? 'comentario' : 'comentarios'}
            </span>
          )}
          {assignee && (
            <span
              title={`Asignada a ${assignee}`}
              className="ml-auto inline-flex h-6 w-6 items-center justify-center rounded-full bg-accent-100 text-[11px] font-semibold text-accent-700"
            >
              <span aria-hidden="true">{initials(assignee)}</span>
              <span className="sr-only">Asignada a {assignee}</span>
            </span>
          )}
        </span>
      )}
    </>
  );
}

export function CardItem({
  card,
  columnName,
  lookups,
  onOpen,
}: {
  card: CardDto;
  columnName: string;
  lookups: CardLookups;
  onOpen: (cardId: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id,
    data: {
      type: 'card',
      columnId: card.columnId,
      label: `la tarjeta «${card.title}»`,
      columnLabel: `la columna «${columnName}»`,
    },
  });

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    // Space picks the card up (keyboard drag); Enter opens it.
    if (e.key === 'Enter' && !isDragging) {
      e.preventDefault();
      onOpen(card.id);
      return;
    }
    listeners?.onKeyDown?.(e);
  }

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onKeyDown={onKeyDown}
      onClick={() => onOpen(card.id)}
      aria-roledescription="tarjeta arrastrable"
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`block w-full cursor-grab rounded-md border border-slate-200 bg-white p-3 text-left shadow-sm hover:border-accent-600 focus:outline-2 focus:outline-offset-1 focus:outline-accent-600 ${
        isDragging ? 'opacity-40' : ''
      }`}
    >
      <CardFace card={card} lookups={lookups} />
    </div>
  );
}
