import type { UpdateSettingsInput } from '@kanban/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId } from 'react';
import { Alert, Card, Loading } from '../../components/ui';
import { api } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { toast } from '../../lib/toast';

const settingsKey = ['settings'] as const;

export function SettingsPage() {
  const qc = useQueryClient();
  const id = useId();
  const q = useQuery({
    queryKey: settingsKey,
    queryFn: () => api<UpdateSettingsInput>('GET', '/api/me/settings'),
  });
  const save = useMutation({
    mutationFn: (input: UpdateSettingsInput) =>
      api<UpdateSettingsInput>('PATCH', '/api/me/settings', input),
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: settingsKey });
      const previous = qc.getQueryData<UpdateSettingsInput>(settingsKey);
      qc.setQueryData(settingsKey, input);
      return { previous };
    },
    onError: (err, _input, ctx) => {
      qc.setQueryData(settingsKey, ctx?.previous);
      toast(errorMessage(err), 'error');
    },
    onSuccess: (saved) => {
      qc.setQueryData(settingsKey, saved);
      toast('Ajuste guardado');
    },
  });

  return (
    <div className="max-w-xl space-y-4">
      <h1 className="text-2xl font-semibold">Ajustes</h1>
      {q.isPending ? (
        <Loading />
      ) : q.isError ? (
        <Alert>{errorMessage(q.error)}</Alert>
      ) : (
        <Card>
          <div className="flex items-start gap-3">
            <input
              id={id}
              type="checkbox"
              role="switch"
              checked={q.data.emailNotifications}
              disabled={save.isPending}
              onChange={(e) => save.mutate({ emailNotifications: e.target.checked })}
              className="mt-1 h-5 w-5"
              aria-describedby={`${id}-help`}
            />
            <div>
              <label htmlFor={id} className="text-sm font-medium">
                Recibir avisos por correo
              </label>
              <p id={`${id}-help`} className="text-sm text-slate-600">
                Te escribimos cuando te mencionan, te asignan una tarjeta o comentan en una tuya.
                Los avisos dentro de la aplicación y el buzón no cambian.
              </p>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
