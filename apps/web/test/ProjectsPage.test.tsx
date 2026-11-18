import type { MeDto } from '@kanban/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectsPage } from '../src/features/orgs/ProjectsPage';
import { ME_KEY } from '../src/lib/auth';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function renderAs(role: 'admin' | 'member') {
  const me = {
    user: { id: 'u1', name: 'Luis', email: 'l@x.com', isDemo: false },
    memberships: [{ orgId: 'o1', orgName: 'Acme', role }],
  } as MeDto;
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) =>
      Promise.resolve(
        url === '/api/auth/me'
          ? json(200, me)
          : json(200, [{ id: 'p1', name: 'Web corporativa', createdAt: '2026-11-18T10:00:00Z' }]),
      ),
    ),
  );
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData<MeDto>(ME_KEY, me);
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/o/o1']}>
        <Routes>
          <Route path="/o/:orgId" element={<ProjectsPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('ProjectsPage', () => {
  it('an admin can create projects', async () => {
    renderAs('admin');
    expect(await screen.findByText('Web corporativa')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Crear proyecto' })).toBeInTheDocument();
  });

  it('a member sees the projects but no create form', async () => {
    renderAs('member');
    expect(await screen.findByText('Web corporativa')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Crear proyecto' })).toBeNull();
    expect(screen.queryByLabelText('Nombre del proyecto')).toBeNull();
    expect(
      screen.getByText('Solo los administradores pueden crear proyectos.'),
    ).toBeInTheDocument();
  });
});
