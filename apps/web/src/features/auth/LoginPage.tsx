import { LoginInput, type MeDto } from '@kanban/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AuthShell, Alert, Button, TextField } from '../../components/ui';
import { api } from '../../lib/api';
import { ME_KEY, safeReturnPath } from '../../lib/auth';
import { errorMessage } from '../../lib/errors';
import { validate, type FieldErrors } from '../../lib/validation';

export function LoginPage() {
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
    const parsed = validate(LoginInput, {
      email: form.get('email'),
      password: form.get('password'),
    });
    setErrors(parsed.errors ?? {});
    setFailure(null);
    if (!parsed.data) return;
    setBusy(true);
    try {
      const me = await api<MeDto>('POST', '/api/auth/login', parsed.data);
      qc.clear();
      qc.setQueryData(ME_KEY, me);
      const first = me.memberships[0];
      navigate(volver ?? (first ? `/o/${first.orgId}` : '/'), { replace: true });
    } catch (err) {
      setFailure(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const registerLink = volver ? `/registro?volver=${encodeURIComponent(volver)}` : '/registro';

  return (
    <AuthShell title="Entrar">
      <form onSubmit={(e) => void onSubmit(e)} noValidate className="space-y-4">
        {failure && <Alert>{failure}</Alert>}
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
          autoComplete="current-password"
          required
          error={errors.password}
        />
        <Button type="submit" disabled={busy} className="w-full">
          {busy ? 'Entrando…' : 'Entrar'}
        </Button>
      </form>
      <p className="mt-4 text-center text-sm text-slate-600">
        ¿No tienes cuenta?{' '}
        <Link to={registerLink} className="font-medium text-accent-600 hover:underline">
          Crear cuenta
        </Link>
      </p>
    </AuthShell>
  );
}
