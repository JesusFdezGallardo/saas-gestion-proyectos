import type { MailboxEntryDto, MailStatus } from '@kanban/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, Button, Card, Loading } from '../../components/ui';
import { api } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { shortDateTime } from '../../lib/time';

export const mailboxKey = ['mailbox'] as const;

export const STATUS_LABEL: Record<MailStatus, string> = {
  sent: 'Enviado',
  skipped_demo: 'Solo buzón (demo)',
  skipped_limit: 'Límite diario',
  skipped_blocked: 'Bloqueado',
  failed: 'Error',
  stored: 'Pendiente',
};

const STATUS_TONE: Record<MailStatus, string> = {
  sent: 'bg-green-100 text-green-800',
  skipped_demo: 'bg-blue-100 text-blue-800',
  skipped_limit: 'bg-amber-100 text-amber-800',
  skipped_blocked: 'bg-amber-100 text-amber-800',
  failed: 'bg-red-100 text-red-800',
  stored: 'bg-slate-200 text-slate-700',
};

export function StatusBadge({ status }: { status: MailStatus }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_TONE[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

/** «Mi buzón»: the emails the app sent (or only kept) for the signed-in address. */
export function MailboxPage() {
  const q = useQuery({
    queryKey: mailboxKey,
    queryFn: () => api<MailboxEntryDto[]>('GET', '/api/mailbox'),
    // The email usually lands a moment after the notification: look again when coming back.
    refetchOnWindowFocus: 'always',
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const emails = q.data ?? [];
  const selected = emails.find((m) => m.id === selectedId) ?? null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Mi buzón</h1>
        <Button
          type="button"
          variant="secondary"
          disabled={q.isFetching}
          onClick={() => void q.refetch()}
        >
          {q.isFetching ? 'Actualizando…' : 'Actualizar'}
        </Button>
      </div>
      <p className="text-sm text-slate-600">
        Aquí quedan guardados los correos de aviso, aunque no se hayan enviado de verdad.
      </p>
      {q.isPending ? (
        <Loading />
      ) : q.isError && !q.data ? (
        <Alert>{errorMessage(q.error)}</Alert>
      ) : emails.length === 0 ? (
        <p className="text-sm text-slate-500">No hay correos todavía.</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
          <ul aria-label="Correos" className="space-y-2">
            {emails.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  aria-current={m.id === selectedId ? 'true' : undefined}
                  onClick={() => setSelectedId(m.id)}
                  className={`block w-full rounded-lg border p-3 text-left hover:bg-slate-50 ${
                    m.id === selectedId
                      ? 'border-accent-600 bg-accent-50'
                      : 'border-slate-200 bg-white'
                  }`}
                >
                  <span className="block text-sm font-medium break-words">{m.subject}</span>
                  <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <time dateTime={m.createdAt}>{shortDateTime(m.createdAt)}</time>
                    <StatusBadge status={m.status} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <div>
            {selected ? (
              <EmailView key={selected.id} email={selected} />
            ) : (
              <Card>
                <p className="text-sm text-slate-500">Elige un correo para verlo.</p>
              </Card>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function EmailView({ email }: { email: MailboxEntryDto }) {
  const [asText, setAsText] = useState(false);
  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold break-words">{email.subject}</h2>
          <p className="mt-1 flex items-center gap-2 text-xs text-slate-500">
            {shortDateTime(email.createdAt)} <StatusBadge status={email.status} />
          </p>
        </div>
        <Button type="button" variant="secondary" onClick={() => setAsText((v) => !v)}>
          {asText ? 'Ver correo con formato' : 'Ver como texto'}
        </Button>
      </div>
      {asText ? (
        <pre className="max-h-[32rem] overflow-auto rounded-md bg-slate-50 p-3 text-sm break-words whitespace-pre-wrap">
          {email.text}
        </pre>
      ) : (
        // No scripts and no same-origin access: the HTML of the email cannot touch the app.
        <iframe
          title={`Correo: ${email.subject}`}
          sandbox=""
          srcDoc={email.html}
          className="h-[28rem] w-full rounded-md border border-slate-200 bg-white"
        />
      )}
    </Card>
  );
}
