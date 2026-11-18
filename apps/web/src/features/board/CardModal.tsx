import type { BoardDto, CardDto, UpdateCardInput } from '@kanban/shared';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Modal } from '../../components/Modal';
import { Button, TextField } from '../../components/ui';
import { toast } from '../../lib/toast';
import { useBoard, useBoardActions } from './useBoard';

interface Draft {
  title: string;
  description: string;
  assigneeId: string | null;
  dueDate: string | null;
  labelIds: string[];
}

const draftOf = (c: CardDto): Draft => ({
  title: c.title,
  description: c.description,
  assigneeId: c.assigneeId,
  dueDate: c.dueDate,
  labelIds: c.labelIds,
});

const sameSet = (a: string[], b: string[]) =>
  a.length === b.length && a.every((x) => b.includes(x));

/** Only the fields that differ from the card, so concurrent edits of other fields survive. */
function changes(card: CardDto, d: Draft): UpdateCardInput {
  const patch: UpdateCardInput = {};
  if (d.title.trim() !== card.title) patch.title = d.title.trim();
  if (d.description !== card.description) patch.description = d.description;
  if (d.assigneeId !== card.assigneeId) patch.assigneeId = d.assigneeId;
  if (d.dueDate !== card.dueDate) patch.dueDate = d.dueDate;
  if (!sameSet(d.labelIds, card.labelIds)) patch.labelIds = d.labelIds;
  return patch;
}

/**
 * Card detail, opened with `?card=<id>`. If the card disappears from the board (deleted by
 * someone else) it closes itself and says so.
 */
export function CardModal({
  orgId,
  projectId,
  cardId,
  onClose,
}: {
  orgId: string;
  projectId: string;
  cardId: string;
  onClose: () => void;
}) {
  const { data: board } = useBoard(orgId, projectId);
  const card = board?.cards.find((c) => c.id === cardId);
  const seen = useRef(false);
  const closed = useRef(false);
  const deleting = useRef(false);

  useEffect(() => {
    if (!board || closed.current) return;
    if (card) {
      seen.current = true;
      return;
    }
    closed.current = true;
    if (!deleting.current) {
      toast(seen.current ? 'La tarjeta se ha borrado' : 'No se ha encontrado la tarjeta');
    }
    onClose();
  }, [board, card, onClose]);

  if (!board || !card) return null;
  return (
    <CardForm
      key={card.id}
      orgId={orgId}
      projectId={projectId}
      board={board}
      card={card}
      onClose={onClose}
      onDeleting={(v) => (deleting.current = v)}
    />
  );
}

function CardForm({
  orgId,
  projectId,
  board,
  card,
  onClose,
  onDeleting,
}: {
  orgId: string;
  projectId: string;
  board: BoardDto;
  card: CardDto;
  onClose: () => void;
  onDeleting: (deleting: boolean) => void;
}) {
  const actions = useBoardActions(orgId, projectId);
  // null = untouched: the form follows remote edits until the user starts typing.
  const [draft, setDraft] = useState<Draft | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const ids = { desc: useId(), assignee: useId(), due: useId(), labels: useId() };

  const values = draft ?? draftOf(card);
  const edit = (patch: Partial<Draft>) => setDraft({ ...values, ...patch });
  const patch = changes(card, values);
  const dirty = Object.keys(patch).length > 0;
  const column = board.columns.find((c) => c.id === card.columnId);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const title = values.title.trim();
    if (title.length < 1 || title.length > 200) {
      setHint('Escribe un título (máximo 200 caracteres).');
      return;
    }
    if (values.description.length > 5000) {
      setHint('La descripción admite como máximo 5000 caracteres.');
      return;
    }
    setHint(null);
    if (!dirty) return;
    setSaving(true);
    try {
      await actions.updateCard(card.id, patch);
      setDraft(null);
      toast('Cambios guardados');
    } catch {
      // `send` already showed why.
    } finally {
      setSaving(false);
    }
  }

  async function onDelete() {
    onDeleting(true);
    try {
      await actions.deleteCard(card.id);
      toast('Tarjeta borrada');
    } catch {
      onDeleting(false);
    }
  }

  const field =
    'block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:outline-2 focus:outline-accent-600';

  return (
    <Modal title={card.title} onClose={onClose} size="lg">
      {column && <p className="-mt-3 mb-4 text-sm text-slate-500">En «{column.name}»</p>}
      <form onSubmit={onSubmit} className="space-y-4">
        <TextField
          label="Título"
          value={values.title}
          maxLength={200}
          onChange={(e) => edit({ title: e.target.value })}
          error={hint ?? undefined}
        />
        <div>
          <label htmlFor={ids.desc} className="mb-1 block text-sm font-medium text-slate-700">
            Descripción
          </label>
          <textarea
            id={ids.desc}
            rows={5}
            maxLength={5000}
            value={values.description}
            onChange={(e) => edit({ description: e.target.value })}
            className={field}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor={ids.assignee} className="mb-1 block text-sm font-medium text-slate-700">
              Persona asignada
            </label>
            <select
              id={ids.assignee}
              value={values.assigneeId ?? ''}
              onChange={(e) => edit({ assigneeId: e.target.value || null })}
              className={`${field} min-h-10`}
            >
              <option value="">Sin asignar</option>
              {board.members.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={ids.due} className="mb-1 block text-sm font-medium text-slate-700">
              Fecha límite
            </label>
            <div className="flex gap-2">
              <input
                id={ids.due}
                type="date"
                value={values.dueDate ?? ''}
                onChange={(e) => edit({ dueDate: e.target.value || null })}
                className={`${field} min-h-10`}
              />
              {values.dueDate && (
                <Button type="button" variant="secondary" onClick={() => edit({ dueDate: null })}>
                  Quitar
                </Button>
              )}
            </div>
          </div>
        </div>
        <fieldset>
          <legend id={ids.labels} className="mb-1 block text-sm font-medium text-slate-700">
            Etiquetas
          </legend>
          {board.labels.length === 0 ? (
            <p className="text-sm text-slate-500">
              Este proyecto aún no tiene etiquetas. Créalas con el botón «Etiquetas» del tablero.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {board.labels.map((l) => {
                const checked = values.labelIds.includes(l.id);
                return (
                  <label
                    key={l.id}
                    className={`inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-full border px-3 text-sm ${
                      checked ? 'border-slate-500 bg-slate-100' : 'border-slate-200'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        edit({
                          labelIds: checked
                            ? values.labelIds.filter((x) => x !== l.id)
                            : [...values.labelIds, l.id],
                        })
                      }
                    />
                    <span
                      aria-hidden="true"
                      className="h-3 w-3 rounded-full"
                      style={{ backgroundColor: l.color }}
                    />
                    {l.name}
                  </label>
                );
              })}
            </div>
          )}
        </fieldset>

        <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 pt-4">
          <Button type="submit" disabled={!dirty || saving}>
            {saving ? 'Guardando…' : 'Guardar cambios'}
          </Button>
          {dirty && (
            <Button type="button" variant="secondary" onClick={() => setDraft(null)}>
              Descartar
            </Button>
          )}
          <div className="ml-auto">
            {confirmDelete ? (
              <span className="flex flex-wrap items-center gap-2 text-sm">
                ¿Borrar esta tarjeta?
                <Button type="button" variant="danger" onClick={() => void onDelete()}>
                  Sí, borrar
                </Button>
                <Button type="button" variant="secondary" onClick={() => setConfirmDelete(false)}>
                  Cancelar
                </Button>
              </span>
            ) : (
              <Button type="button" variant="danger" onClick={() => setConfirmDelete(true)}>
                Borrar tarjeta
              </Button>
            )}
          </div>
        </div>
      </form>

      {/* Task 14: comments thread (section «Comentarios») goes here. */}
    </Modal>
  );
}
