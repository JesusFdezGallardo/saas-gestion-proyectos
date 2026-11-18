import type { MeDto } from '@kanban/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppLayout } from '../src/components/AppLayout';

vi.mock('../src/lib/socket', () => ({
  getSocket: () => ({ connected: true, on: vi.fn(), off: vi.fn() }),
  closeSocket: vi.fn(),
}));

const me: MeDto = {
  user: { id: 'u1', name: 'Ana', email: 'ana@x.com', isDemo: false },
  memberships: [{ orgId: 'own-org', orgName: 'Estudio Acme', role: 'admin' }],
} as MeDto;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function Where() {
  const l = useLocation();
  return <p data-testid="where">{l.pathname}</p>;
}

function renderAt(url: string) {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string) =>
      Promise.resolve(
        input === '/api/auth/me'
          ? json(200, me)
          : input.includes('unread-count')
            ? json(200, { count: 0 })
            : json(200, []),
      ),
    ),
  );
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[url]}>
        <Where />
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="/o/:orgId" element={<p>proyectos</p>} />
            <Route path="/o/:orgId/p/:projectId" element={<p>tablero</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('AppLayout with an organization the user does not belong to', () => {
  it('shows an error with a link to their own organization instead of redirecting', async () => {
    renderAt('/o/foreign-org');
    expect(
      await screen.findByText('Esta organización no existe o no tienes acceso a ella.'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('where').textContent).toBe('/o/foreign-org');
    expect(screen.queryByText('proyectos')).toBeNull();
    expect(screen.getByRole('link', { name: 'Ir a Estudio Acme' })).toHaveAttribute(
      'href',
      '/o/own-org',
    );
  });

  it('also for a board URL of that organization', async () => {
    renderAt('/o/foreign-org/p/some-project');
    expect(
      await screen.findByText('Esta organización no existe o no tienes acceso a ella.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('tablero')).toBeNull();
    expect(screen.getByTestId('where').textContent).toBe('/o/foreign-org/p/some-project');
  });

  it('renders the page normally for an own organization', async () => {
    renderAt('/o/own-org');
    expect(await screen.findByText('proyectos')).toBeInTheDocument();
    expect(screen.queryByText(/no existe o no tienes acceso/)).toBeNull();
  });
});
