import type { InvitationInfoDto, MeDto } from '@kanban/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Alert, AuthShell, Button, Loading } from '../../components/ui';
import { api, ApiError } from '../../lib/api';
import { endSession, ME_KEY, useMe } from '../../lib/auth';
import { errorMessage } from '../../lib/errors';

export function AcceptInvitePage() {
  const token = useParams().token!;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: me } = useMe();

  const info = useQuery({
    queryKey: ['invitation', token],
    queryFn: () => api<InvitationInfoDto>('GET', `/api/invitations/${encodeURIComponent(token)}`),
    retry: false,
  });

  const accept = useMutation({
    mutationFn: () => api<MeDto>('POST', `/api/invitations/${encodeURIComponent(token)}/accept`),
    onSuccess: (updated) => {
      const before = new Set(me?.memberships.map((m) => m.orgId));
      const joined =
        updated.memberships.find((m) => !before.has(m.orgId)) ??
        updated.memberships.find((m) => m.orgName === info.data?.orgName) ??
        updated.memberships[0];
      qc.setQueryData(ME_KEY, updated);
      navigate(joined ? `/o/${joined.orgId}` : '/', { replace: true });
    },
  });

  if (info.isPending) {
    return (
      <AuthShell title="Invitación">
        <Loading />
      </AuthShell>
    );
  }

  if (info.isError) {
    const gone = info.error instanceof ApiError && info.error.status === 404;
    return (
      <AuthShell title="Invitación">
        <Alert>
          {gone ? 'Esta invitación no existe o ya no es válida.' : errorMessage(info.error)}
        </Alert>
      </AuthShell>
    );
  }

  const { orgName, email, expired, accepted } = info.data;
  const back = encodeURIComponent(`/invitacion/${token}`);
  const open = !expired && !accepted;
  // The server accepts only with the invited address (emails compare case-insensitively).
  const otherAccount = me !== undefined && me.user.email.toLowerCase() !== email.toLowerCase();

  return (
    <AuthShell title="Invitación">
      <p className="text-center text-sm text-slate-700">
        Te han invitado a unirte a <strong>{orgName}</strong> con el correo <strong>{email}</strong>
        .
      </p>
      <div className="mt-5 space-y-3">
        {accepted && <Alert>Esta invitación ya se ha usado.</Alert>}
        {expired && !accepted && (
          <Alert>Esta invitación ha caducado. Pide una nueva a un administrador.</Alert>
        )}
        {accept.isError && <Alert>{errorMessage(accept.error)}</Alert>}
        {open && me && otherAccount && (
          <>
            <p className="text-center text-xs text-slate-500">
              Esta invitación es para {email}; has entrado como {me.user.email}.
            </p>
            <Button
              type="button"
              variant="secondary"
              className="w-full"
              onClick={() => void endSession(qc, navigate, `/entrar?volver=${back}`)}
            >
              Entrar con otra cuenta
            </Button>
          </>
        )}
        {open && me && !otherAccount && (
          <>
            <p className="text-center text-xs text-slate-500">Has entrado como {me.user.email}.</p>
            <Button
              type="button"
              className="w-full"
              disabled={accept.isPending}
              onClick={() => accept.mutate()}
            >
              Aceptar
            </Button>
          </>
        )}
        {open && !me && (
          <div className="flex flex-col gap-2">
            <Link
              to={`/entrar?volver=${back}`}
              className="inline-flex min-h-10 items-center justify-center rounded-md bg-accent-600 px-4 py-2 text-sm font-medium text-white hover:bg-accent-700"
            >
              Entrar
            </Link>
            <Link
              to={`/registro?volver=${back}`}
              className="inline-flex min-h-10 items-center justify-center rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              Crear cuenta
            </Link>
          </div>
        )}
      </div>
    </AuthShell>
  );
}
