import type { BoardMemberDto } from '@kanban/shared';
import { useId, useRef, useState, type KeyboardEvent, type TextareaHTMLAttributes } from 'react';

/** Lowercase without accents, so "alv" finds "Álvaro". */
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const MAX_OPTIONS = 6;
/** `@` at the start or after whitespace, then letters (no spaces) up to the caret. */
const TRIGGER = /(^|\s)@([\p{L}\p{N}_.-]*)$/u;

/** The mention token for a member; the name cannot break the token's syntax. */
export function mentionToken(m: BoardMemberDto): string {
  const name =
    m.name
      .replace(/[\]\n]/g, '')
      .slice(0, 80)
      .trim() || 'Usuario';
  return `@[${name}](user:${m.userId}) `;
}

type Props = Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  'value' | 'onChange' | 'id' | 'aria-label'
> & {
  label: string;
  /** Hide the visible label (it stays available to screen readers). */
  hideLabel?: boolean;
  members: BoardMemberDto[];
  value: string;
  onChange: (value: string) => void;
};

/**
 * Textarea that suggests board members after an `@` and inserts `@[Name](user:<id>) `.
 * The raw token stays visible in the field; rendered comments show it as a highlighted name.
 */
export function MentionInput({ label, hideLabel, members, value, onChange, ...rest }: Props) {
  const id = useId();
  const listId = `${id}-list`;
  const ref = useRef<HTMLTextAreaElement>(null);
  const [caret, setCaret] = useState(0);
  const [active, setActive] = useState(0);
  // The trigger text the user dismissed with Escape stays closed until it changes.
  const [dismissed, setDismissed] = useState<string | null>(null);

  const before = value.slice(0, caret);
  const match = TRIGGER.exec(before);
  const query = match?.[2] ?? null;
  const options =
    query === null
      ? []
      : members.filter((m) => fold(m.name).includes(fold(query))).slice(0, MAX_OPTIONS);
  const open = query !== null && options.length > 0 && dismissed !== before;
  const current = Math.min(active, Math.max(options.length - 1, 0));
  const optionId = (i: number) => `${id}-opt-${i}`;

  function insert(m: BoardMemberDto) {
    if (!match) return;
    const start = caret - match[2]!.length - 1;
    const token = mentionToken(m);
    const next = value.slice(0, start) + token + value.slice(caret);
    const pos = start + token.length;
    onChange(next);
    setCaret(pos);
    setActive(0);
    // Put the caret after the inserted token once React has rendered the new value.
    requestAnimationFrame(() => {
      const el = ref.current;
      if (el) {
        el.focus();
        el.setSelectionRange(pos, pos);
      }
    });
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (!open) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((current + 1) % options.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((current - 1 + options.length) % options.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      insert(options[current]!);
    } else if (e.key === 'Escape') {
      // Closes the list only, not the dialog around it.
      e.preventDefault();
      e.stopPropagation();
      setDismissed(before);
    }
  }

  return (
    <div className="relative">
      <label
        htmlFor={id}
        className={hideLabel ? 'sr-only' : 'mb-1 block text-sm font-medium text-slate-700'}
      >
        {label}
      </label>
      <textarea
        rows={3}
        {...rest}
        ref={ref}
        id={id}
        value={value}
        aria-autocomplete="list"
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? optionId(current) : undefined}
        onChange={(e) => {
          setCaret(e.target.selectionStart);
          setActive(0);
          onChange(e.target.value);
        }}
        onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
        onKeyDown={onKeyDown}
        className="block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:outline-2 focus:outline-accent-600"
      />
      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Personas a las que mencionar"
          className="absolute z-10 mt-1 max-h-48 w-64 max-w-full overflow-auto rounded-md border border-slate-200 bg-white py-1 shadow-lg"
        >
          {options.map((m, i) => (
            <li
              key={m.userId}
              id={optionId(i)}
              role="option"
              aria-selected={i === current}
              // Keep the focus in the textarea while clicking.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => insert(m)}
              className={`cursor-pointer px-3 py-1.5 text-sm ${
                i === current ? 'bg-accent-100 text-accent-700' : 'text-slate-700'
              }`}
            >
              {m.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
