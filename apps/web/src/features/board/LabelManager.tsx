import { LABEL_COLORS, type LabelColor, type LabelDto } from '@kanban/shared';
import { useState, type FormEvent } from 'react';
import { Modal } from '../../components/Modal';
import { Button } from '../../components/ui';
import type { BoardActions } from './useBoard';

const COLOR_NAMES: Record<LabelColor, string> = {
  '#ef4444': 'Rojo',
  '#f97316': 'Naranja',
  '#eab308': 'Amarillo',
  '#22c55e': 'Verde',
  '#14b8a6': 'Turquesa',
  '#3b82f6': 'Azul',
  '#8b5cf6': 'Violeta',
  '#ec4899': 'Rosa',
};

function ColorPicker({
  value,
  onChange,
  name,
}: {
  value: string;
  onChange: (c: LabelColor) => void;
  name: string;
}) {
  return (
    <div role="radiogroup" aria-label={`Color de ${name}`} className="flex flex-wrap gap-1.5">
      {LABEL_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          aria-label={COLOR_NAMES[c]}
          title={COLOR_NAMES[c]}
          onClick={() => onChange(c)}
          className={`h-7 w-7 rounded-full border-2 focus:outline-2 focus:outline-offset-1 focus:outline-accent-600 ${
            value === c ? 'border-slate-900' : 'border-white'
          }`}
          style={{ backgroundColor: c }}
        />
      ))}
    </div>
  );
}

function LabelRow({ label, actions }: { label: LabelDto; actions: BoardActions }) {
  const [name, setName] = useState(label.name);
  const [confirm, setConfirm] = useState(false);

  async function saveName() {
    const trimmed = name.trim();
    if (!trimmed) return setName(label.name);
    if (trimmed === label.name) return;
    await actions.updateLabel(label.id, { name: trimmed }).catch(() => setName(label.name));
  }

  return (
    <li className="space-y-2 rounded-md border border-slate-200 p-3">
      <div className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className="h-4 w-4 shrink-0 rounded-full"
          style={{ backgroundColor: label.color }}
        />
        <input
          aria-label="Nombre de la etiqueta"
          value={name}
          maxLength={40}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => void saveName()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
          className="block min-h-9 min-w-0 flex-1 rounded-md border border-slate-300 px-2 text-sm"
        />
        {confirm ? (
          <>
            <Button
              type="button"
              variant="danger"
              className="min-h-9 px-3"
              onClick={() => void actions.deleteLabel(label.id).catch(() => setConfirm(false))}
            >
              Sí, borrar
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="min-h-9 px-3"
              onClick={() => setConfirm(false)}
            >
              No
            </Button>
          </>
        ) : (
          <Button
            type="button"
            variant="danger"
            className="min-h-9 px-3"
            onClick={() => setConfirm(true)}
            aria-label={`Borrar la etiqueta «${label.name}»`}
          >
            Borrar
          </Button>
        )}
      </div>
      <ColorPicker
        name={label.name}
        value={label.color}
        onChange={(color) => void actions.updateLabel(label.id, { color }).catch(() => undefined)}
      />
    </li>
  );
}

/** Create, rename, recolour and delete the project's labels. */
export function LabelManager({
  labels,
  actions,
  onClose,
}: {
  labels: LabelDto[];
  actions: BoardActions;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [color, setColor] = useState<LabelColor>(LABEL_COLORS[5]);
  const [busy, setBusy] = useState(false);

  async function create(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      await actions.createLabel({ name: trimmed, color });
      setName('');
    } catch {
      // `send` already showed why.
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Etiquetas del proyecto" onClose={onClose}>
      <form onSubmit={(e) => void create(e)} className="mb-5 space-y-2">
        <div className="flex gap-2">
          <input
            aria-label="Nombre de la nueva etiqueta"
            placeholder="Nueva etiqueta"
            value={name}
            maxLength={40}
            onChange={(e) => setName(e.target.value)}
            className="block min-h-10 min-w-0 flex-1 rounded-md border border-slate-300 px-3 text-sm"
          />
          <Button type="submit" disabled={busy || !name.trim()}>
            Crear
          </Button>
        </div>
        <ColorPicker name="la nueva etiqueta" value={color} onChange={setColor} />
      </form>
      {labels.length === 0 ? (
        <p className="text-sm text-slate-500">Aún no hay etiquetas.</p>
      ) : (
        <ul className="space-y-2">
          {labels.map((l) => (
            <LabelRow key={`${l.id}:${l.name}`} label={l} actions={actions} />
          ))}
        </ul>
      )}
    </Modal>
  );
}
