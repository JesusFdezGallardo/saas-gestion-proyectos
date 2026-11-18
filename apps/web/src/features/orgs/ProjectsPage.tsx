import { CreateProjectInput, type ProjectDto } from '@kanban/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Alert, Button, Card, Loading, TextField } from '../../components/ui';
import { api } from '../../lib/api';
import { useMe } from '../../lib/auth';
import { errorMessage } from '../../lib/errors';

export const projectsKey = (orgId: string) => ['projects', orgId] as const;

export function ProjectsPage() {
  const orgId = useParams().orgId!;
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [hint, setHint] = useState<string | null>(null);
  const { data: me } = useMe();
  // Only admins create projects (the API answers 403 to members).
  const isAdmin = me?.memberships.find((m) => m.orgId === orgId)?.role === 'admin';

  const projects = useQuery({
    queryKey: projectsKey(orgId),
    queryFn: () => api<ProjectDto[]>('GET', `/api/orgs/${orgId}/projects`),
  });

  const create = useMutation({
    mutationFn: (input: CreateProjectInput) =>
      api<ProjectDto>('POST', `/api/orgs/${orgId}/projects`, input),
    onSuccess: (project) => {
      qc.setQueryData<ProjectDto[]>(projectsKey(orgId), (list) => [...(list ?? []), project]);
      setName('');
    },
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const parsed = CreateProjectInput.safeParse({ name });
    if (!parsed.success) {
      setHint('Escribe un nombre para el proyecto (máximo 100 caracteres).');
      return;
    }
    setHint(null);
    create.mutate(parsed.data);
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Proyectos</h1>

      {isAdmin ? (
        <Card>
          <form onSubmit={onSubmit} className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <TextField
                label="Nombre del proyecto"
                value={name}
                onChange={(e) => setName(e.target.value)}
                error={hint ?? undefined}
              />
            </div>
            <Button type="submit" disabled={create.isPending}>
              Crear proyecto
            </Button>
          </form>
          {create.isError && (
            <div className="mt-3">
              <Alert>{errorMessage(create.error)}</Alert>
            </div>
          )}
        </Card>
      ) : (
        <p className="text-sm text-slate-600">Solo los administradores pueden crear proyectos.</p>
      )}

      {projects.isPending && <Loading />}
      {projects.isError && <Alert>{errorMessage(projects.error)}</Alert>}
      {projects.data && projects.data.length === 0 && (
        <p className="text-sm text-slate-600">
          {isAdmin ? 'Todavía no hay proyectos. Crea el primero.' : 'Todavía no hay proyectos.'}
        </p>
      )}
      {projects.data && projects.data.length > 0 && (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {projects.data.map((p) => (
            <li key={p.id}>
              <Link
                to={`/o/${orgId}/p/${p.id}`}
                className="block rounded-lg border border-slate-200 bg-white p-4 shadow-sm transition-colors hover:border-accent-600"
              >
                <span className="block font-medium break-words">{p.name}</span>
                <span className="mt-1 block text-xs text-slate-500">
                  Creado el {new Date(p.createdAt).toLocaleDateString('es-ES')}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
