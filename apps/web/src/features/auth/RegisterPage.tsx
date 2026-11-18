import { RegisterInput, type MeDto } from '@kanban/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Alert, AuthShell, Button, TextField } from '../../components/ui';
import { api } from '../../lib/api';
import { safeReturnPath, startSession } from '../../lib/auth';
import { errorMessage } from '../../lib/errors';
import { validate, type FieldErrors } from '../../lib/validation';

export function RegisterPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const volver = safeReturnPath(params.get('volver'));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const parsed = validate(RegisterInput, {
      name: form.get('name'),
      email: form.get('email'),
      password: form.get('password'),
      orgName: form.get('orgName'),
    });
    setErrors(parsed.errors ?? {});
    setFailure(null);
    if (!parsed.data) return;
    setBusy(true);
    try {
      const me = await api<MeDto>('POST', '/api/auth/register', parsed.data);
      startSession(qc, me);
      const first = me.memberships[0];
      navigate(volver ?? (first ? `/o/${first.orgId}` : '/'), { replace: true });
    } catch (err) {
      setFailure(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const loginLink = volver ? `/entrar?volver=${encodeURIComponent(volver)}` : '/entrar';

  return (
    <AuthShell title="Crear cuenta">
      <form onSubmit={(e) => void onSubmit(e)} noValidate className="space-y-4">
        {failure && <Alert>{failure}</Alert>}
        <TextField label="Nombre" name="name" autoComplete="name" required error={errors.name} />
        <TextField
          label="Correo electrónico"
          name="email"
          type="email"
          autoComplete="email"
          required
          error={errors.email}
        />
        <TextField
          label="Contraseña"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
          error={errors.password}
        />
        <TextField
          label="Nombre de la organización"
          name="orgName"
          required
          error={errors.orgName}
        />
        <Button type="submit" disabled={busy} className="w-full">
          {busy ? 'Creando…' : 'Crear cuenta'}
        </Button>
      </form>
      <p className="mt-4 text-center text-sm text-slate-600">
        ¿Ya tienes cuenta?{' '}
        <Link to={loginLink} className="font-medium text-accent-600 hover:underline">
          Entrar
        </Link>
      </p>
    </AuthShell>
  );
}
