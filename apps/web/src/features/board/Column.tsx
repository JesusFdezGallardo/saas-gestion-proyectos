import type { CardDto, ColumnDto } from '@kanban/shared';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useId, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Modal } from '../../components/Modal';
import { Button } from '../../components/ui';
import { CardItem, type CardLookups } from './CardItem';
import type { BoardActions } from './useBoard';

export const listId = (columnId: string) => `list:${columnId}`;

export function Column({
  column,
  cards,
  columns,
  lookups,
  actions,
  onOpenCard,
}: {
  column: ColumnDto;
  /** Cards in display order (may differ from the cache while a card is being dragged). */
  cards: CardDto[];
  /** Every column of the board, in order (for the "move cards to" choice when deleting). */
  columns: ColumnDto[];
  lookups: CardLookups;
  actions: BoardActions;
  onOpenCard: (cardId: string) => void;
}) {
  const sortable = useSortable({
    id: column.id,
    data: {
      type: 'column',
      label: `la columna «${column.name}»`,
      columnLabel: `la columna «${column.name}»`,
    },
  });
  const list = useDroppable({
    id: listId(column.id),
    data: {
      type: 'list',
      columnId: column.id,
      label: `la columna «${column.name}»`,
      columnLabel: `la columna «${column.name}»`,
    },
  });
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const headingId = useId();

  return (
    <section
      ref={sortable.setNodeRef}
      aria-labelledby={headingId}
      style={{
        transform: CSS.Translate.toString(sortable.transform),
        transition: sortable.transition,
      }}
      className={`flex max-h-[calc(100vh-12rem)] w-72 shrink-0 flex-col rounded-lg bg-slate-100 ${
        sortable.isDragging ? 'opacity-40' : ''
      }`}
    >
      <header className="flex items-center gap-1 px-2 pt-2">
        <button
          type="button"
          {...sortable.attributes}
          {...sortable.listeners}
          aria-roledescription="columna arrastrable"
          aria-label={`Mover la columna «${column.name}»`}
          className="min-h-9 min-w-7 cursor-grab rounded text-slate-400 hover:bg-slate-200 hover:text-slate-700 focus:outline-2 focus:outline-accent-600"
        >
          <span aria-hidden="true">⠿</span>
        </button>
        {renaming ? (
          <RenameForm
            initial={column.name}
            onCancel={() => setRenaming(false)}
            onSave={async (name) => {
              if (name !== column.name) await actions.renameColumn(column.id, name);
              setRenaming(false);
            }}
          />
        ) : (
          <h2 id={headingId} className="min-w-0 flex-1">
            <button
              type="button"
              onClick={() => setRenaming(true)}
              className="block min-h-9 w-full truncate rounded px-1 text-left text-sm font-semibold text-slate-800 hover:bg-slate-200"
            >
              {column.name}
              <span aria-hidden="true" className="ml-2 text-xs font-normal text-slate-500">
                {cards.length}
              </span>
              <span className="sr-only">
                , {cards.length} {cards.length === 1 ? 'tarjeta' : 'tarjetas'}. Cambiar el nombre
              </span>
            </button>
          </h2>
        )}
        <button
          type="button"
          onClick={() => setDeleting(true)}
          disabled={columns.length <= 1}
          title={
            columns.length <= 1 ? 'Un tablero necesita al menos una columna' : 'Borrar la columna'
          }
          aria-label={`Borrar la columna «${column.name}»`}
          className="min-h-9 min-w-9 rounded text-slate-400 hover:bg-slate-200 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-slate-400"
        >
          <span aria-hidden="true">✕</span>
        </button>
      </header>

      <div
        ref={list.setNodeRef}
        className={`flex min-h-16 flex-1 flex-col gap-2 overflow-y-auto p-2 ${
          list.isOver ? 'rounded-md bg-accent-50' : ''
        }`}
      >
        <SortableContext items={cards.map((c) => c.id)} strategy={verticalListSortingStrategy}>
          {cards.map((card) => (
            <CardItem
              key={card.id}
              card={card}
              columnName={column.name}
              lookups={lookups}
              onOpen={onOpenCard}
            />
          ))}
        </SortableContext>
        {cards.length === 0 && (
          <p className="py-3 text-center text-xs text-slate-500">Arrastra tarjetas aquí</p>
        )}
      </div>

      <NewCardForm onCreate={(title) => actions.createCard(column.id, title)} />

      {deleting && (
        <DeleteColumnDialog
          column={column}
          cardCount={cards.length}
          others={columns.filter((c) => c.id !== column.id)}
          onClose={() => setDeleting(false)}
          onConfirm={async (moveTo) => {
            await actions.deleteColumn(column.id, moveTo);
          }}
        />
      )}
    </section>
  );
}

/** Column name editor: Enter or blur saves, Escape cancels. */
function RenameForm({
  initial,
  onSave,
  onCancel,
}: {
  initial: string;
  onSave: (name: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);

  async function save(e?: FormEvent) {
    e?.preventDefault();
    if (busy) return;
    const trimmed = name.trim();
    if (!trimmed) return onCancel();
    setBusy(true);
    try {
      await onSave(trimmed.slice(0, 60));
    } catch {
      setBusy(false); // `send` already showed why; keep the editor open.
    }
  }

  return (
    <form onSubmit={(e) => void save(e)} className="min-w-0 flex-1">
      <input
        aria-label="Nombre de la columna"
        autoFocus
        value={name}
        maxLength={60}
        disabled={busy}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => void save()}
        onKeyDown={(e: KeyboardEvent) => {
          if (e.key === 'Escape') onCancel();
        }}
        className="block min-h-9 w-full rounded border border-accent-600 bg-white px-2 text-sm font-semibold focus:outline-none"
      />
    </form>
  );
}

function NewCardForm({ onCreate }: { onCreate: (title: string) => Promise<unknown> }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      await onCreate(trimmed);
      setTitle(''); // Stay open to add several in a row.
    } catch {
      // `send` already showed why.
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="m-2 mt-0 min-h-9 rounded-md px-2 text-left text-sm text-slate-600 hover:bg-slate-200"
      >
        + tarjeta
      </button>
    );
  }
  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-2 p-2 pt-0">
      <textarea
        aria-label="Título de la nueva tarjeta"
        autoFocus
        rows={2}
        maxLength={200}
        value={title}
        placeholder="Título de la tarjeta"
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            e.currentTarget.form?.requestSubmit();
          }
          if (e.key === 'Escape') setOpen(false);
        }}
        className="block w-full resize-none rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm shadow-sm focus:outline-2 focus:outline-accent-600"
      />
      <div className="flex gap-2">
        <Button type="submit" disabled={busy || !title.trim()} className="min-h-9 px-3">
          Añadir
        </Button>
        <Button
          type="button"
          variant="secondary"
          className="min-h-9 px-3"
          onClick={() => {
            setOpen(false);
            setTitle('');
          }}
        >
          Cancelar
        </Button>
      </div>
    </form>
  );
}

function DeleteColumnDialog({
  column,
  cardCount,
  others,
  onClose,
  onConfirm,
}: {
  column: ColumnDto;
  cardCount: number;
  others: ColumnDto[];
  onClose: () => void;
  onConfirm: (moveTo: string | undefined) => Promise<void>;
}) {
  const [moveTo, setMoveTo] = useState(others[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const selectId = useId();
  // Another tab may delete the chosen target meanwhile: fall back to the first one left.
  const target = others.some((c) => c.id === moveTo) ? moveTo : (others[0]?.id ?? '');

  async function confirm() {
    setBusy(true);
    try {
      await onConfirm(cardCount > 0 ? target : undefined);
      onClose();
    } catch {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Borrar la columna «${column.name}»`} onClose={onClose} size="sm">
      <div className="space-y-4 text-sm">
        {cardCount > 0 ? (
          <div>
            <label htmlFor={selectId} className="mb-1 block text-slate-700">
              Tiene {cardCount} {cardCount === 1 ? 'tarjeta' : 'tarjetas'}. ¿A qué columna quieres
              moverlas?
            </label>
            <select
              id={selectId}
              value={target}
              onChange={(e) => setMoveTo(e.target.value)}
              className="block min-h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm"
            >
              {others.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <p className="text-slate-700">La columna está vacía. ¿Seguro que quieres borrarla?</p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            type="button"
            variant="danger"
            disabled={busy || (cardCount > 0 && !target)}
            onClick={() => void confirm()}
          >
            {cardCount > 0 ? 'Mover y borrar' : 'Borrar columna'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
