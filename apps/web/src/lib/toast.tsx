import { useSyncExternalStore } from 'react';

type Tone = 'info' | 'error';
interface Toast {
  id: number;
  message: string;
  tone: Tone;
}

let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function dismissToast(id: number): void {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

/** Shows a short message at the bottom of the screen; callable from anywhere (no context). */
export function toast(message: string, tone: Tone = 'info'): void {
  // The same message twice in a row (e.g. several failed moves) is shown once.
  if (toasts.some((t) => t.message === message)) return;
  const id = nextId++;
  toasts = [...toasts, { id, message, tone }].slice(-4);
  emit();
  setTimeout(() => dismissToast(id), 5000);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function Toaster() {
  const list = useSyncExternalStore(
    subscribe,
    () => toasts,
    () => toasts,
  );
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4"
    >
      {list.map((t) => (
        <div
          key={t.id}
          role={t.tone === 'error' ? 'alert' : 'status'}
          className={`pointer-events-auto flex max-w-md items-center gap-3 rounded-md px-4 py-2 text-sm shadow-lg ${
            t.tone === 'error' ? 'bg-red-700 text-white' : 'bg-slate-800 text-white'
          }`}
        >
          <span>{t.message}</span>
          <button
            type="button"
            onClick={() => dismissToast(t.id)}
            aria-label="Cerrar aviso"
            className="rounded px-1 text-white/80 hover:text-white"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
