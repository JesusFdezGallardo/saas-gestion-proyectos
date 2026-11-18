import type { DemoUserDto, MeDto } from '@kanban/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Button } from '../../components/ui';
import { api } from '../../lib/api';
import { ME_KEY } from '../../lib/auth';
import { errorMessage } from '../../lib/errors';

/**
 * "Entrar como …" buttons for the public demo. They render only when the server answers
 * `/api/demo/users` with data (DEMO_MODE on and seeded); otherwise nothing is shown.
 */
export function DemoButtons({ volver }: { volver: string | null }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const { data } = useQuery({
    queryKey: ['demo-users'],
    queryFn: () => api<DemoUserDto[]>('GET', '/api/demo/users'),
    retry: false,
    staleTime: 60_000,
  });

  if (!data || data.length === 0) return null;

  async function enter(email: string) {
    setBusy(email);
    setFailure(null);
    try {
      const me = await api<MeDto>('POST', '/api/auth/demo-login', { email });
      qc.clear();
      qc.setQueryData(ME_KEY, me);
      const first = me.memberships[0];
      navigate(volver ?? (first ? `/o/${first.orgId}` : '/'), { replace: true });
    } catch (err) {
      setFailure(errorMessage(err));
      setBusy(null);
    }
  }

  return (
    <section aria-label="Demo" className="mt-6 border-t border-slate-200 pt-4">
      <h2 className="text-sm font-semibold text-slate-800">Probar la demo</h2>
      {failure && <Alert>{failure}</Alert>}
      <div className="mt-3 grid grid-cols-2 gap-2">
        {data.map((u) => (
          <Button
            key={u.email}
            type="button"
            variant="secondary"
            disabled={busy !== null}
            onClick={() => void enter(u.email)}
            title={u.orgName}
            className="flex-col !items-start gap-0 text-left"
          >
            <span>Entrar como {u.name.split(' ')[0]}</span>
            <span className="text-xs font-normal text-slate-500">{u.orgName}</span>
          </Button>
        ))}
      </div>
      <p className="mt-3 text-xs text-slate-600">
        La demo se reinicia cada día; lo que crees se borrará.
      </p>
      <p className="mt-1 text-xs text-slate-600">La primera carga puede tardar ~1 minuto.</p>
    </section>
  );
}
