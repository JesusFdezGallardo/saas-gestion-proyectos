import type { BoardDto, CardDto } from '@kanban/shared';
import {
  closestCenter,
  closestCorners,
  DndContext,
  DragOverlay,
  KeyboardCode,
  KeyboardSensor,
  MouseSensor,
  pointerWithin,
  TouchSensor,
  useSensor,
  useSensors,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type DroppableContainer,
  type KeyboardCoordinateGetter,
  type UniqueIdentifier,
} from '@dnd-kit/core';
import {
  arrayMove,
  horizontalListSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import { useCallback, useMemo, useState, type FormEvent } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Alert, Button, Loading } from '../../components/ui';
import { ApiError } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { cardsInColumn, sortedColumns } from './applyEvent';
import { CardFace, type CardLookups } from './CardItem';
import { CardModal } from './CardModal';
import { Column } from './Column';
import { LabelManager } from './LabelManager';
import { useBoard, useBoardActions } from './useBoard';
import { useBoardRealtime } from './useBoardRealtime';

type DragState =
  | {
      type: 'card';
      id: string;
      fromColumn: string;
      /** Card ids per column while dragging (the dragged card may hop between columns). */
      containers: Record<string, string[]>;
      original: string[];
    }
  | { type: 'column'; id: string };

/** Anything dnd-kit attaches our `data` to (active, over, droppable containers). */
type WithData = { data: { current?: Record<string, unknown> | undefined } } | null | undefined;

const typeOf = (x: WithData): string | undefined => x?.data.current?.type as string | undefined;
const labelOf = (x: WithData): string =>
  (x?.data.current?.label as string | undefined) ?? 'el elemento';

const findContainer = (containers: Record<string, string[]>, id: string) =>
  Object.keys(containers).find((col) => containers[col]!.includes(id));

/**
 * Cards collide with cards and with the column lists (so empty columns accept drops); columns
 * only with columns. With a pointer, whatever is under it wins; the keyboard uses the nearest.
 */
const collisionDetection: CollisionDetection = (args) => {
  if (typeOf(args.active) === 'column') {
    return closestCenter({
      ...args,
      droppableContainers: args.droppableContainers.filter((d) => typeOf(d) === 'column'),
    });
  }
  const droppableContainers = args.droppableContainers.filter((d) => typeOf(d) !== 'column');
  const hits = pointerWithin({ ...args, droppableContainers });
  if (hits.length > 0) {
    const cards = hits.filter(
      (h) => typeOf(droppableContainers.find((d) => d.id === h.id)) === 'card',
    );
    return cards.length > 0 ? cards : hits;
  }
  return closestCorners({ ...args, droppableContainers });
};

/**
 * Keyboard moves that make sense on a board. The stock getter considers every droppable, so
 * from a card it can pick its own column (whose edge is just left of the card) and never leave.
 * Columns: only other columns. Cards: Up/Down among the cards of the same column; Left/Right
 * straight to the neighbouring column's list (the card lands at its top).
 */
const keyboardCoordinates: KeyboardCoordinateGetter = (event, args) => {
  const { active, collisionRect, droppableContainers, droppableRects } = args.context;
  const only = (keep: (d: DroppableContainer) => boolean) => {
    const restricted = {
      getEnabled: () => droppableContainers.getEnabled().filter(keep),
      get: (id: UniqueIdentifier | null | undefined) => droppableContainers.get(id),
    } as unknown as typeof droppableContainers;
    return sortableKeyboardCoordinates(event, {
      ...args,
      context: { ...args.context, droppableContainers: restricted },
    });
  };

  if (!active || !collisionRect) return sortableKeyboardCoordinates(event, args);
  if (typeOf(active) === 'column') return only((d) => typeOf(d) === 'column');

  const left = event.code === KeyboardCode.Left;
  if (!left && event.code !== KeyboardCode.Right) {
    const container = (x: WithData) =>
      (x?.data.current?.sortable as { containerId?: UniqueIdentifier } | undefined)?.containerId;
    const own = container(active);
    return only((d) => typeOf(d) === 'card' && container(d) === own);
  }

  event.preventDefault();
  const center = collisionRect.left + collisionRect.width / 2;
  let best: { left: number; top: number; width: number; distance: number } | undefined;
  for (const d of droppableContainers.getEnabled()) {
    const rect = droppableRects.get(d.id);
    if (typeOf(d) !== 'list' || !rect) continue;
    const c = rect.left + rect.width / 2;
    const distance = left ? center - c : c - center;
    if (distance > rect.width / 2 && (!best || distance < best.distance)) {
      best = { left: rect.left, top: rect.top, width: rect.width, distance };
    }
  }
  if (!best) return undefined;
  return { x: best.left + (best.width - collisionRect.width) / 2, y: best.top };
};

/** "la columna «X»" for whatever is under the dragged item. */
const placeOf = (over: WithData): string =>
  (over?.data.current?.columnLabel as string | undefined) ?? labelOf(over);

const announcements: Announcements = {
  onDragStart: ({ active }) => `Has cogido ${labelOf(active)}.`,
  onDragOver: ({ active, over }) =>
    over
      ? `${labelOf(active)} está en ${placeOf(over)}.`
      : `${labelOf(active)} no está sobre ninguna columna.`,
  onDragEnd: ({ active, over }) =>
    over
      ? `Has soltado ${labelOf(active)} en ${placeOf(over)}.`
      : `Has soltado ${labelOf(active)}.`,
  onDragCancel: ({ active }) => `Movimiento cancelado: ${labelOf(active)} vuelve a su sitio.`,
};

const screenReaderInstructions = {
  draggable:
    'Para mover este elemento pulsa la barra espaciadora. Después usa las flechas para llevarlo a otro sitio y vuelve a pulsar la barra espaciadora para soltarlo, o Escape para cancelar. Pulsa Intro para abrir una tarjeta.',
};

export function BoardPage() {
  const { orgId = '', projectId = '' } = useParams();
  const board = useBoard(orgId, projectId);
  useBoardRealtime(orgId, projectId);
  const [params, setParams] = useSearchParams();
  const openCardId = params.get('card');

  const openCard = useCallback(
    (cardId: string) =>
      setParams((p) => {
        const next = new URLSearchParams(p);
        next.set('card', cardId);
        return next;
      }),
    [setParams],
  );
  const closeCard = useCallback(
    () =>
      setParams(
        (p) => {
          const next = new URLSearchParams(p);
          next.delete('card');
          return next;
        },
        { replace: true },
      ),
    [setParams],
  );

  if (board.isPending) return <Loading label="Cargando el tablero…" />;
  if (board.isError) {
    const missing = board.error instanceof ApiError && board.error.status === 404;
    return (
      <div className="space-y-3">
        <Alert>
          {missing ? 'Este proyecto no existe o no tienes acceso a él.' : errorMessage(board.error)}
        </Alert>
        <Link to={`/o/${orgId}`} className="text-sm text-accent-700 underline">
          Volver a los proyectos
        </Link>
      </div>
    );
  }

  return (
    <>
      <Board orgId={orgId} projectId={projectId} board={board.data} onOpenCard={openCard} />
      {openCardId && (
        <CardModal
          // A new `?card=` is a new modal: its "seen/closed" refs must start over.
          key={openCardId}
          orgId={orgId}
          projectId={projectId}
          cardId={openCardId}
          onClose={closeCard}
        />
      )}
    </>
  );
}

function Board({
  orgId,
  projectId,
  board,
  onOpenCard,
}: {
  orgId: string;
  projectId: string;
  board: BoardDto;
  onOpenCard: (cardId: string) => void;
}) {
  const actions = useBoardActions(orgId, projectId);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [labelsOpen, setLabelsOpen] = useState(false);

  const sensors = useSensors(
    // A few pixels before a drag starts, so a click still opens the card.
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    // On touch screens a short press starts the drag, so the board can still be scrolled.
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: keyboardCoordinates,
      // Enter is kept for opening the card.
      keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space', 'Enter'] },
    }),
  );

  const columns = useMemo(() => sortedColumns(board), [board]);
  const cardById = useMemo(() => new Map(board.cards.map((c) => [c.id, c])), [board.cards]);
  const lookups: CardLookups = useMemo(
    () => ({
      labels: new Map(board.labels.map((l) => [l.id, l])),
      members: new Map(board.members.map((m) => [m.userId, m.name])),
    }),
    [board.labels, board.members],
  );

  const cardsOf = (columnId: string): CardDto[] => {
    if (drag?.type === 'card') {
      const ids = drag.containers[columnId] ?? [];
      return ids.map((id) => cardById.get(id)).filter((c) => c !== undefined);
    }
    return cardsInColumn(board, columnId);
  };

  function onDragStart({ active }: DragStartEvent) {
    const id = String(active.id);
    if (typeOf(active) === 'column') {
      setDrag({ type: 'column', id });
      return;
    }
    const card = cardById.get(id);
    if (!card) return;
    const containers: Record<string, string[]> = {};
    for (const col of columns) containers[col.id] = cardsInColumn(board, col.id).map((c) => c.id);
    setDrag({
      type: 'card',
      id,
      fromColumn: card.columnId,
      containers,
      original: containers[card.columnId] ?? [],
    });
  }

  /** Moving over another column: the card joins it right away (so the list makes room). */
  function onDragOver({ active, over }: DragOverEvent) {
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    const overIsList = typeOf(over) === 'list';
    const overColumn = over.data.current?.columnId as string | undefined;
    const rect = active.rect.current.translated;
    const below = rect !== null && rect.top > over.rect.top + over.rect.height / 2;
    // Functional update: several drag-over events can arrive before the next render.
    setDrag((d) => {
      if (d?.type !== 'card') return d;
      const to = overIsList ? overColumn : findContainer(d.containers, overId);
      const from = findContainer(d.containers, activeId);
      if (!from || !to || from === to) return d;
      const target = d.containers[to] ?? [];
      let index = target.length;
      if (!overIsList) index = target.indexOf(overId) + (below ? 1 : 0);
      return {
        ...d,
        containers: {
          ...d.containers,
          [from]: d.containers[from]!.filter((x) => x !== activeId),
          [to]: [...target.slice(0, index), activeId, ...target.slice(index)],
        },
      };
    });
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    const state = drag;
    setDrag(null);
    if (!state || !over) return;
    const activeId = String(active.id);

    if (state.type === 'column') {
      const ids = columns.map((c) => c.id);
      const from = ids.indexOf(activeId);
      const to = ids.indexOf(String(over.id));
      if (from < 0 || to < 0 || from === to) return;
      void actions.moveColumn(activeId, to);
      return;
    }

    const column = findContainer(state.containers, activeId);
    if (!column) return;
    let list = state.containers[column]!;
    if (typeOf(over) === 'card' && list.includes(String(over.id))) {
      const a = list.indexOf(activeId);
      const b = list.indexOf(String(over.id));
      if (a !== b) list = arrayMove(list, a, b);
    }
    const unchanged =
      column === state.fromColumn &&
      list.length === state.original.length &&
      list.every((id, i) => id === state.original[i]);
    if (unchanged) return;

    // Translate the visual neighbours into an index among the cards the cache has now
    // (a remote change may have added or removed cards while dragging).
    const i = list.indexOf(activeId);
    const beforeId = list[i - 1];
    const afterId = list[i + 1];
    const others = cardsInColumn(board, column)
      .map((c) => c.id)
      .filter((id) => id !== activeId);
    let index = others.length;
    if (beforeId && others.includes(beforeId)) index = others.indexOf(beforeId) + 1;
    else if (afterId && others.includes(afterId)) index = others.indexOf(afterId);
    else if (i === 0) index = 0;
    void actions.moveCard(activeId, column, index);
  }

  const draggedCard = drag?.type === 'card' ? cardById.get(drag.id) : undefined;
  const draggedColumn = drag?.type === 'column' ? columns.find((c) => c.id === drag.id) : undefined;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-2xl font-semibold break-words">{board.project.name}</h1>
        <Button variant="secondary" onClick={() => setLabelsOpen(true)}>
          Etiquetas
        </Button>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        accessibility={{ announcements, screenReaderInstructions }}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={() => setDrag(null)}
      >
        <div className="-mx-4 flex items-start gap-3 overflow-x-auto px-4 pb-4">
          <SortableContext
            items={columns.map((c) => c.id)}
            strategy={horizontalListSortingStrategy}
          >
            {columns.map((col) => (
              <Column
                key={col.id}
                column={col}
                cards={cardsOf(col.id)}
                columns={columns}
                lookups={lookups}
                actions={actions}
                onOpenCard={onOpenCard}
              />
            ))}
          </SortableContext>
          <NewColumnForm onCreate={(name) => actions.createColumn(name)} />
        </div>
        <DragOverlay>
          {draggedCard ? (
            <div className="w-68 cursor-grabbing rounded-md border border-accent-600 bg-white p-3 shadow-lg">
              <CardFace card={draggedCard} lookups={lookups} />
            </div>
          ) : draggedColumn ? (
            <div className="w-72 cursor-grabbing rounded-lg bg-slate-200 p-3 text-sm font-semibold shadow-lg">
              {draggedColumn.name}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {labelsOpen && (
        <LabelManager
          labels={board.labels}
          actions={actions}
          onClose={() => setLabelsOpen(false)}
        />
      )}
    </div>
  );
}

function NewColumnForm({ onCreate }: { onCreate: (name: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      await onCreate(trimmed);
      setName('');
      setOpen(false);
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
        className="min-h-10 w-56 shrink-0 rounded-lg border-2 border-dashed border-slate-300 px-3 text-left text-sm text-slate-600 hover:border-accent-600 hover:text-accent-700"
      >
        + columna
      </button>
    );
  }
  return (
    <form
      onSubmit={(e) => void submit(e)}
      className="w-72 shrink-0 space-y-2 rounded-lg bg-slate-100 p-2"
    >
      <input
        aria-label="Nombre de la nueva columna"
        autoFocus
        placeholder="Nombre de la columna"
        value={name}
        maxLength={60}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false);
        }}
        className="block min-h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm focus:outline-2 focus:outline-accent-600"
      />
      <div className="flex gap-2">
        <Button type="submit" disabled={busy || !name.trim()} className="min-h-9 px-3">
          Añadir columna
        </Button>
        <Button
          type="button"
          variant="secondary"
          className="min-h-9 px-3"
          onClick={() => setOpen(false)}
        >
          Cancelar
        </Button>
      </div>
    </form>
  );
}
