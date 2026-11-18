import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DemoButtons } from '../src/features/auth/DemoButtons';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function renderButtons() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <DemoButtons volver={null} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return qc;
}

afterEach(() => vi.unstubAllGlobals());

describe('DemoButtons', () => {
  it('renders nothing when the server has no demo users (404)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(json(404, { error: { code: 'not_found', message: 'x' } })),
    );
    renderButtons();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(screen.queryByText(/Entrar como/)).toBeNull();
    expect(screen.queryByText(/se reinicia cada día/)).toBeNull();
  });

  it('shows one button per demo user and both notices', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        json(200, [
          { email: 'ana@demo.local', name: 'Ana López', orgName: 'Estudio Acme' },
          { email: 'pablo@demo.local', name: 'Pablo Sanz', orgName: 'Otra Empresa' },
        ]),
      ),
    );
    renderButtons();
    expect(await screen.findByRole('button', { name: /Entrar como Ana/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Entrar como Pablo/ })).toBeInTheDocument();
    expect(
      screen.getByText('La demo se reinicia cada día; lo que crees se borrará.'),
    ).toBeInTheDocument();
    expect(screen.getByText('La primera carga puede tardar ~1 minuto.')).toBeInTheDocument();
  });

  it('posts the chosen email to demo-login and stores the session', async () => {
    const me = {
      user: { id: 'u1', email: 'ana@demo.local', name: 'Ana López', isDemo: true },
      memberships: [{ orgId: 'o1', orgName: 'Estudio Acme', role: 'admin' }],
    };
    const fetchMock = vi.fn((_url: string, init?: RequestInit) =>
      Promise.resolve(
        init?.method === 'POST'
          ? json(200, me)
          : json(200, [{ email: 'ana@demo.local', name: 'Ana López', orgName: 'Estudio Acme' }]),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const qc = renderButtons();
    await userEvent.click(await screen.findByRole('button', { name: /Entrar como Ana/ }));
    await vi.waitFor(() => expect(qc.getQueryData(['me'])).toEqual(me));
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(post?.[0]).toBe('/api/auth/demo-login');
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({ email: 'ana@demo.local' });
  });
});
