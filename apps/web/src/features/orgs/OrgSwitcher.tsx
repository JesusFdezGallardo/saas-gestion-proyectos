import { CreateOrgInput, type MeDto } from '@kanban/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Button, TextField } from '../../components/ui';
import { api } from '../../lib/api';
import { ME_KEY } from '../../lib/auth';
import { errorMessage } from '../../lib/errors';

/** Form that creates an organization and moves to it. */
export function NewOrgForm({ onDone }: { onDone?: () => void }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const parsed = CreateOrgInput.safeParse({ name });
    if (!parsed.success) {
      setFailure('Escribe el nombre de la organización (máximo 100 caracteres).');
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      const org = await api<{ id: string; name: string; role: 'admin' }>(
        'POST',
        '/api/orgs',
        parsed.data,
      );
      qc.setQueryData<MeDto>(ME_KEY, (me) =>
        me
          ? {
              ...me,
              memberships: [
                ...me.memberships,
                { orgId: org.id, orgName: org.name, role: org.role },
              ],
            }
          : me,
      );
      setName('');
      onDone?.();
      navigate(`/o/${org.id}`);
    } catch (err) {
      setFailure(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(e) => void onSubmit(e)} className="space-y-3">
      {failure && <Alert>{failure}</Alert>}
      <TextField
        label="Nombre de la organización"
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
      />
      <Button type="submit" disabled={busy}>
        {busy ? 'Creando…' : 'Crear organización'}
      </Button>
    </form>
  );
}

export function OrgSwitcher({ me, currentOrgId }: { me: MeDto; currentOrgId: string }) {
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);

  return (
    <div className="relative flex items-center gap-2">
      <select
        aria-label="Organización"
        value={currentOrgId}
        onChange={(e) => navigate(`/o/${e.target.value}`)}
        className="min-h-9 max-w-40 rounded-md border border-slate-300 bg-white px-2 text-sm sm:max-w-64"
      >
        {me.memberships.map((m) => (
          <option key={m.orgId} value={m.orgId}>
            {m.orgName}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => setCreating((v) => !v)}
        aria-expanded={creating}
        className="min-h-9 rounded-md px-2 text-sm text-accent-600 hover:bg-accent-50"
      >
        Nueva organización
      </button>
      {creating && (
        <div className="absolute top-full left-0 z-20 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-lg border border-slate-200 bg-white p-4 shadow-lg">
          <NewOrgForm onDone={() => setCreating(false)} />
        </div>
      )}
    </div>
  );
}
