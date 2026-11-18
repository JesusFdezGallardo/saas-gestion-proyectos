import { useCallback, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useDismiss } from '../lib/useDismiss';

const item = 'block w-full rounded px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100';

/** The signed-in user's menu: mailbox, settings, sign out. */
export function UserMenu({ name, onLogout }: { name: string; onLogout: () => void }) {
  const menuId = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => {
    setOpen(false);
    trigger.current?.focus();
  }, []);
  useDismiss(open, root, close);

  return (
    <div ref={root} className="relative">
      <button
        ref={trigger}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((o) => !o)}
        className="flex min-h-9 items-center gap-1 rounded-md px-2 text-sm text-slate-700 hover:bg-slate-100"
      >
        <span className="max-w-32 truncate">{name}</span>
        <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label="Cuenta"
          className="absolute right-0 z-30 mt-2 w-44 rounded-lg border border-slate-200 bg-white p-1 shadow-xl"
        >
          <Link role="menuitem" to="/buzon" onClick={() => setOpen(false)} className={item}>
            Mi buzón
          </Link>
          <Link role="menuitem" to="/ajustes" onClick={() => setOpen(false)} className={item}>
            Ajustes
          </Link>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onLogout();
            }}
            className={item}
          >
            Salir
          </button>
        </div>
      )}
    </div>
  );
}
