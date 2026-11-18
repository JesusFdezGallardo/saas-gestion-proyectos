import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';
import { useId } from 'react';

const cx = (...parts: (string | false | undefined)[]) => parts.filter(Boolean).join(' ');

type Variant = 'primary' | 'secondary' | 'danger';
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent-600 text-white hover:bg-accent-700 disabled:bg-accent-600/50',
  secondary:
    'border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 disabled:text-slate-400',
  danger: 'border border-red-300 bg-white text-red-700 hover:bg-red-50 disabled:text-red-300',
};

export function Button({
  variant = 'primary',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      {...props}
      className={cx(
        'inline-flex min-h-10 items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition-colors focus:outline-2 focus:outline-offset-2 focus:outline-accent-600 disabled:cursor-not-allowed',
        VARIANTS[variant],
        className,
      )}
    />
  );
}

export function TextField({
  label,
  error,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string | undefined }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-slate-700">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-err` : undefined}
        {...props}
        className={cx(
          'block min-h-10 w-full rounded-md border bg-white px-3 py-2 text-sm shadow-sm focus:outline-2 focus:outline-accent-600',
          error ? 'border-red-400' : 'border-slate-300',
        )}
      />
      {error && (
        <p id={`${id}-err`} className="mt-1 text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

export function Alert({ children }: { children: ReactNode }) {
  return (
    <div
      role="alert"
      className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
    >
      {children}
    </div>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx('rounded-lg border border-slate-200 bg-white p-4 shadow-sm', className)}>
      {children}
    </div>
  );
}

export function Loading({ label = 'Cargando…' }: { label?: string }) {
  return (
    <p role="status" className="p-6 text-center text-sm text-slate-500">
      {label}
    </p>
  );
}

/** Centered card layout shared by the login, register and invitation pages. */
export function AuthShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-8">
      <div className="w-full max-w-sm">
        <p className="mb-1 text-center text-sm font-semibold tracking-wide text-accent-600 uppercase">
          Tablero Kanban
        </p>
        <h1 className="mb-6 text-center text-2xl font-semibold">{title}</h1>
        <Card className="p-6">{children}</Card>
      </div>
    </main>
  );
}
