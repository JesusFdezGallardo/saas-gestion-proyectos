import type { InvitationInfoDto, MeDto } from '@kanban/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AcceptInvitePage } from '../src/features/orgs/AcceptInvitePage';

const fake = vi.hoisted(() => ({ closeSocket: vi.fn() }));
vi.mock('../src/lib/socket', () => ({ getSocket: vi.fn(), closeSocket: fake.closeSocket }));

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const me = (email: string): MeDto =>
  ({
    user: { id: 'u1', name: 'Luis', email, isDemo: false },
    memberships: [],
  }) as unknown as MeDto;

function Where() {
  const l = useLocation();
  return <p data-testid="where">{l.pathname + l.search}</p>;
}

function renderPage(info: InvitationInfoDto, session: MeDto | null) {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (url === '/api/auth/me') {
      return Promise.resolve(
        session
          ? json(200, session)
          : json(401, { error: { code: 'unauthenticated', message: 'x' } }),
      );
    }
    if (url === '/api/auth/logout' && init?.method === 'POST') {
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    return Promise.resolve(json(200, info));
  });
  vi.stubGlobal('fetch', fetchMock);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/invitacion/tok123']}>
        <Where />
        <Routes>
          <Route path="/invitacion/:token" element={<AcceptInvitePage />} />
          <Route path="/entrar" element={<p>login</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return fetchMock;
}

const base: InvitationInfoDto = {
  orgName: 'Acme',
  email: 'luis@x.com',
  expired: false,
  accepted: false,
};

afterEach(() => vi.unstubAllGlobals());

describe('AcceptInvitePage', () => {
  it('offers to accept when signed in with the invited address', async () => {
    renderPage(base, me('Luis@x.com'));
    expect(await screen.findByRole('button', { name: 'Aceptar' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Entrar con otra cuenta' })).toBeNull();
  });

  it('says the invitation was already used instead of offering to accept it', async () => {
    renderPage({ ...base, accepted: true }, me('luis@x.com'));
    expect(await screen.findByText('Esta invitación ya se ha usado.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Aceptar' })).toBeNull();
  });

  it('with another account signed in, offers to sign in with another one', async () => {
    const fetchMock = renderPage(base, me('ana@x.com'));
    const button = await screen.findByRole('button', { name: 'Entrar con otra cuenta' });
    expect(screen.getByText(/Esta invitación es para luis@x\.com/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Aceptar' })).toBeNull();
    await userEvent.click(button);
    await vi.waitFor(() =>
      expect(screen.getByTestId('where').textContent).toBe(
        `/entrar?volver=${encodeURIComponent('/invitacion/tok123')}`,
      ),
    );
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) => url === '/api/auth/logout' && init?.method === 'POST',
      ),
    ).toBe(true);
    expect(fake.closeSocket).toHaveBeenCalled();
  });
});
