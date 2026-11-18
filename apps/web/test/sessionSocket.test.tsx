import type { BoardJoinAck, MeDto } from '@kanban/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DemoButtons } from '../src/features/auth/DemoButtons';
import { LoginPage } from '../src/features/auth/LoginPage';
import { RegisterPage } from '../src/features/auth/RegisterPage';
import { useBoardRealtime } from '../src/features/board/useBoardRealtime';
import { ME_KEY } from '../src/lib/auth';
import { recoverSession } from '../src/lib/demoRecovery';

type Handler = (...args: unknown[]) => void;
const fake = vi.hoisted(() => ({
  closeSocket: vi.fn(),
  getSocket: vi.fn(),
  toast: vi.fn(),
  socket: undefined as unknown,
}));
vi.mock('../src/lib/socket', () => ({
  getSocket: () => {
    fake.getSocket();
    return fake.socket;
  },
  closeSocket: fake.closeSocket,
}));
vi.mock('../src/lib/toast', () => ({ toast: fake.toast }));

const me: MeDto = {
  user: { id: 'u1', name: 'Ana', email: 'ana@x.com', isDemo: false },
  memberships: [{ orgId: 'o1', orgName: 'Acme', role: 'admin' }],
} as MeDto;
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
  return qc;
}

beforeEach(() => {
  fake.closeSocket.mockClear();
  fake.getSocket.mockClear();
  fake.toast.mockClear();
});
afterEach(() => vi.unstubAllGlobals());

describe('a new session gets a new socket', () => {
  it('login closes the old socket so the next one handshakes with the new cookie', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        Promise.resolve(url === '/api/auth/login' ? json(200, me) : json(404, {})),
      ),
    );
    const qc = wrap(<LoginPage />);
    await userEvent.type(screen.getByLabelText('Correo electrónico'), 'ana@x.com');
    await userEvent.type(screen.getByLabelText('Contraseña'), 'contraseña-larga');
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    await vi.waitFor(() => expect(qc.getQueryData(ME_KEY)).toEqual(me));
    expect(fake.closeSocket).toHaveBeenCalledTimes(1);
  });

  it('register closes the old socket', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(201, me)));
    const qc = wrap(<RegisterPage />);
    await userEvent.type(screen.getByLabelText('Nombre'), 'Ana');
    await userEvent.type(screen.getByLabelText('Correo electrónico'), 'ana@x.com');
    await userEvent.type(screen.getByLabelText('Contraseña'), 'contraseña-larga');
    await userEvent.type(screen.getByLabelText('Nombre de la organización'), 'Acme');
    await userEvent.click(screen.getByRole('button', { name: 'Crear cuenta' }));
    await vi.waitFor(() => expect(qc.getQueryData(ME_KEY)).toEqual(me));
    expect(fake.closeSocket).toHaveBeenCalledTimes(1);
  });

  it('demo login closes the old socket', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init?: RequestInit) =>
        Promise.resolve(
          init?.method === 'POST'
            ? json(200, me)
            : json(200, [{ email: 'ana@demo.local', name: 'Ana López', orgName: 'Acme' }]),
        ),
      ),
    );
    const qc = wrap(<DemoButtons volver={null} />);
    await userEvent.click(await screen.findByRole('button', { name: /Entrar como Ana/ }));
    await vi.waitFor(() => expect(qc.getQueryData(ME_KEY)).toEqual(me));
    expect(fake.closeSocket).toHaveBeenCalledTimes(1);
  });

  it('a still valid session reconnects the socket the server closed after a reset', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(200, me)));
    const navigate = vi.fn();
    await recoverSession(new QueryClient(), navigate);
    expect(navigate).not.toHaveBeenCalled();
    expect(fake.closeSocket).not.toHaveBeenCalled();
    expect(fake.getSocket).toHaveBeenCalledTimes(1);
  });

  // Last: the redirect guard stays set until the shell mounts again.
  it('a lost session found by the recovery closes the socket', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(json(401, { error: { code: 'unauthenticated', message: 'x' } })),
    );
    const navigate = vi.fn();
    await recoverSession(new QueryClient(), navigate);
    expect(navigate).toHaveBeenCalledWith('/entrar?motivo=reinicio', { replace: true });
    expect(fake.closeSocket).toHaveBeenCalledTimes(1);
    expect(fake.getSocket).not.toHaveBeenCalled();
  });
});

describe('useBoardRealtime when the server refuses the room', () => {
  function Board() {
    useBoardRealtime(
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
    );
    return null;
  }

  it('clears data-realtime, refetches me and tells the user', () => {
    const handlers = new Map<string, Handler>();
    fake.socket = {
      connected: true,
      on: (ev: string, fn: Handler) => handlers.set(ev, fn),
      off: vi.fn(),
      emit: (ev: string, _ref: unknown, ack?: (a: BoardJoinAck) => void) => {
        if (ev === 'board:join') ack?.({ ok: false, code: 'not_found' });
      },
    };
    document.body.dataset.realtime = 'joined';
    const qc = new QueryClient();
    qc.setQueryData(ME_KEY, me);
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <Board />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(document.body.dataset.realtime).toBeUndefined();
    expect(qc.getQueryState(ME_KEY)?.isInvalidated).toBe(true);
    expect(fake.toast).toHaveBeenCalledWith('No se pudo conectar en tiempo real', 'error');
  });
});
