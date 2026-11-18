import { InviteInput, type MemberDto, type MembershipRole } from '@kanban/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { Alert, Button, Card, Loading, TextField } from '../../components/ui';
import { api } from '../../lib/api';
import { ME_KEY, useMe } from '../../lib/auth';
import { errorMessage } from '../../lib/errors';

const membersKey = (orgId: string) => ['members', orgId] as const;
const ROLE_LABEL: Record<MembershipRole, string> = { admin: 'Administrador', member: 'Miembro' };

function InviteForm({ orgId }: { orgId: string }) {
  const [email, setEmail] = useState('');
  const [hint, setHint] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const invite = useMutation({
    mutationFn: (input: InviteInput) =>
      api<{ link: string }>('POST', `/api/orgs/${orgId}/invitations`, input),
    onSuccess: () => {
      setEmail('');
      setCopied(false);
    },
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const parsed = InviteInput.safeParse({ email });
    if (!parsed.success) {
      setHint('Introduce un correo electrónico válido.');
      return;
    }
    setHint(null);
    invite.mutate(parsed.data);
  }

  async function copy(link: string) {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Card>
      <h2 className="mb-3 text-lg font-medium">Invitar</h2>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <TextField
            label="Correo de la persona invitada"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={hint ?? undefined}
          />
        </div>
        <Button type="submit" disabled={invite.isPending}>
          Invitar
        </Button>
      </form>
      {invite.isError && (
        <div className="mt-3">
          <Alert>{errorMessage(invite.error)}</Alert>
        </div>
      )}
      {invite.data && (
        <div className="mt-4 rounded-md bg-accent-50 p-3 text-sm">
          <p className="mb-2 text-slate-700">
            Invitación creada. Comparte este enlace (caduca en 7 días):
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              readOnly
              aria-label="Enlace de invitación"
              value={invite.data.link}
              onFocus={(e) => e.currentTarget.select()}
              className="min-h-10 flex-1 rounded-md border border-slate-300 bg-white px-3 text-sm"
            />
            <Button type="button" variant="secondary" onClick={() => void copy(invite.data.link)}>
              {copied ? 'Copiado' : 'Copiar'}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

function MemberRow({
  member,
  orgId,
  isAdmin,
  isSelf,
  onError,
}: {
  member: MemberDto;
  orgId: string;
  isAdmin: boolean;
  isSelf: boolean;
  onError: (message: string | null) => void;
}) {
  const qc = useQueryClient();
  // The caller's own role or membership may have changed too.
  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: membersKey(orgId) }),
      qc.invalidateQueries({ queryKey: ME_KEY }),
    ]);

  const changeRole = useMutation({
    mutationFn: (role: MembershipRole) =>
      api<MemberDto>('PATCH', `/api/orgs/${orgId}/members/${member.userId}`, { role }),
    onSuccess: () => {
      onError(null);
      return refresh();
    },
    onError: (err) => onError(errorMessage(err)),
  });
  const remove = useMutation({
    mutationFn: () => api('DELETE', `/api/orgs/${orgId}/members/${member.userId}`),
    onSuccess: () => {
      onError(null);
      return refresh();
    },
    onError: (err) => onError(errorMessage(err)),
  });

  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
      <div className="min-w-0 flex-1 basis-48">
        <p className="truncate font-medium">
          {member.name}
          {isSelf && <span className="ml-2 text-xs font-normal text-slate-500">(tú)</span>}
        </p>
        <p className="truncate text-sm text-slate-600">{member.email}</p>
      </div>
      {isAdmin ? (
        <>
          <select
            aria-label={`Rol de ${member.name}`}
            value={member.role}
            disabled={changeRole.isPending}
            onChange={(e) => changeRole.mutate(e.target.value as MembershipRole)}
            className="min-h-10 rounded-md border border-slate-300 bg-white px-2 text-sm"
          >
            <option value="admin">{ROLE_LABEL.admin}</option>
            <option value="member">{ROLE_LABEL.member}</option>
          </select>
          <Button
            type="button"
            variant="danger"
            disabled={remove.isPending}
            onClick={() => {
              if (window.confirm(`¿Quitar a ${member.name} de la organización?`)) remove.mutate();
            }}
          >
            Quitar
          </Button>
        </>
      ) : (
        <span className="text-sm text-slate-700">{ROLE_LABEL[member.role]}</span>
      )}
    </li>
  );
}

export function MembersPage() {
  const orgId = useParams().orgId!;
  const { data: me } = useMe();
  const [failure, setFailure] = useState<string | null>(null);

  const members = useQuery({
    queryKey: membersKey(orgId),
    queryFn: () => api<MemberDto[]>('GET', `/api/orgs/${orgId}/members`),
  });

  const isAdmin = me?.memberships.find((m) => m.orgId === orgId)?.role === 'admin';

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Miembros</h1>

      {isAdmin && <InviteForm orgId={orgId} />}

      <Card>
        {failure && (
          <div className="mb-3">
            <Alert>{failure}</Alert>
          </div>
        )}
        {members.isPending && <Loading />}
        {members.isError && <Alert>{errorMessage(members.error)}</Alert>}
        {members.data && (
          <ul className="divide-y divide-slate-200">
            {members.data.map((m) => (
              <MemberRow
                key={m.userId}
                member={m}
                orgId={orgId}
                isAdmin={isAdmin}
                isSelf={m.userId === me?.user.id}
                onError={setFailure}
              />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
