import type { MeDto } from '@kanban/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LoginPage } from '../src/features/auth/LoginPage';
import { ME_KEY } from '../src/lib/auth';
import { useDemoRecovery } from '../src/lib/demoRecovery';

type Handler = (...args: unknown[]) => void;
class FakeSocket {
  connected = true;
  private handlers = new Map<string, Set<Handler>>();
  on(ev: string, fn: Handler) {
    if (!this.handlers.has(ev)) this.handlers.set(ev, new Set());
    this.handlers.get(ev)!.add(fn);
  }
  off(ev: string, fn: Handler) {
    this.handlers.get(ev)?.delete(fn);
  }
  emit(ev: string) {
    for (const fn of this.handlers.get(ev) ?? []) fn();
  }
  count(ev: string) {
    return this.handlers.get(ev)?.size ?? 0;
  }
}

let socket: FakeSocket;
vi.mock('../src/lib/socket', () => ({ getSocket: () => socket, closeSocket: vi.fn() }));

const me = (id: string): MeDto =>
  ({ user: { id, name: id, email: `${id}@x.com`, isDemo: true }, memberships: [] }) as MeDto;
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function Where() {
  const l = useLocation();
  return <p data-testid="where">{l.pathname + l.search}</p>;
}
function Shell() {
  useDemoRecovery();
  return <p>shell</p>;
}

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/o/1']}>
        <Where />
        <Routes>
          <Route path="/o/1" element={<Shell />} />
          <Route path="/entrar" element={<p>login</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { qc, ...view };
}

beforeEach(() => {
  socket = new FakeSocket();
});
afterEach(() => vi.unstubAllGlobals());

describe('demo reset / reconnect recovery', () => {
  it('after demo:reset with 401 from me, navigates to /entrar?motivo=reinicio once and clears the cache', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(json(401, { error: { code: 'unauthenticated', message: 'x' } }));
    vi.stubGlobal('fetch', fetchMock);
    const { qc } = setup();
    qc.setQueryData(['cards'], [1]);
    socket.emit('demo:reset');
    await vi.waitFor(() =>
      expect(screen.getByTestId('where').textContent).toBe('/entrar?motivo=reinicio'),
    );
    expect(qc.getQueryData(['cards'])).toBeUndefined();
    // A second reset and a reconnect after redirecting must not redirect or fetch again.
    const calls = fetchMock.mock.calls.length;
    socket.emit('demo:reset');
    socket.emit('connect');
    await Promise.resolve();
    expect(fetchMock.mock.calls.length).toBe(calls);
  });

  it('does not redirect twice when reset and reconnect arrive together', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(json(401, { error: { code: 'unauthenticated', message: 'x' } }));
    vi.stubGlobal('fetch', fetchMock);
    setup();
    socket.emit('demo:reset');
    socket.emit('connect');
    socket.emit('demo:reset');
    await vi.waitFor(() =>
      expect(screen.getByTestId('where').textContent).toBe('/entrar?motivo=reinicio'),
    );
    expect(screen.getByText('login')).toBeInTheDocument();
  });

  it('with a live session it refetches everything except me, without leaving', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(200, me('u1'))));
    const { qc } = setup();
    qc.setQueryData(ME_KEY, me('u1'));
    qc.setQueryData(['cards'], [1]);
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    socket.emit('demo:reset');
    await vi.waitFor(() => expect(invalidate).toHaveBeenCalledTimes(1));
    expect(qc.getQueryState(['cards'])?.isInvalidated).toBe(true);
    expect(qc.getQueryState(ME_KEY)?.isInvalidated).toBe(false);
    expect(qc.getQueryData(['cards'])).toEqual([1]);
    expect(screen.getByTestId('where').textContent).toBe('/o/1');
  });

  it('clears the cache when me returns a different user than the cached one', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(200, me('u2'))));
    const { qc } = setup();
    qc.setQueryData(ME_KEY, me('u1'));
    qc.setQueryData(['cards'], [1]);
    socket.emit('demo:reset');
    await vi.waitFor(() => expect(qc.getQueryData<MeDto>(ME_KEY)?.user.id).toBe('u2'));
    expect(qc.getQueryData(['cards'])).toBeUndefined();
  });

  it('recovers on a reconnect but not on the first connect', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(200, me('u1')));
    vi.stubGlobal('fetch', fetchMock);
    socket.connected = false;
    const { qc } = setup();
    qc.setQueryData(ME_KEY, me('u1'));
    socket.emit('connect'); // first connection
    await Promise.resolve();
    expect(fetchMock).not.toHaveBeenCalled();
    socket.emit('connect'); // reconnection
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });

  it('re-arms after unmount so a later login can be redirected again, and unsubscribes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(json(401, { error: { code: 'unauthenticated', message: 'x' } })),
    );
    const first = setup();
    socket.emit('demo:reset');
    await vi.waitFor(() =>
      expect(screen.getByTestId('where').textContent).toBe('/entrar?motivo=reinicio'),
    );
    first.unmount();
    expect(socket.count('demo:reset')).toBe(0);
    expect(socket.count('connect')).toBe(0);
    setup();
    socket.emit('demo:reset');
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  });
});

describe('LoginPage after a reset', () => {
  const renderLogin = (url: string) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(404, {})));
    const qc = new QueryClient();
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[url]}>
          <LoginPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  };

  it('explains the reset when motivo=reinicio', () => {
    renderLogin('/entrar?motivo=reinicio');
    expect(screen.getByText('La demo se ha reiniciado. Vuelve a entrar.')).toBeInTheDocument();
  });

  it('shows nothing extra otherwise', () => {
    renderLogin('/entrar');
    expect(screen.queryByText(/se ha reiniciado/)).toBeNull();
  });
});
