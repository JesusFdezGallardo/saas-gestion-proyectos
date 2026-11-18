import type { MeDto } from '@kanban/shared';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ME_KEY } from './auth';
import { closeSocket, getSocket } from './socket';

/** Set once we sent the user to the login page, so repeated events never redirect twice. */
let redirected = false;
/** One recovery at a time: `demo:reset` and the reconnect that follows share one `me` call. */
let running: Promise<void> | undefined;

/** Calls `/api/auth/me` directly: `api()` would hard-redirect on 401 and lose `?motivo`. */
async function fetchMe(): Promise<MeDto | 'unauthenticated' | 'failed'> {
  try {
    const res = await fetch('/api/auth/me', { credentials: 'include' });
    if (res.status === 401) return 'unauthenticated';
    if (!res.ok) return 'failed';
    return (await res.json()) as MeDto;
  } catch {
    return 'failed';
  }
}

/**
 * The server may have slept, restarted or reset the demo while this tab was open. Checks the
 * session once: gone → empty the cache and go to the login page (once, no reload loop); another
 * user than the cached one → empty the cache; same user → refetch everything that is on screen.
 */
export function recoverSession(
  qc: QueryClient,
  navigate: (to: string, opts: { replace: boolean }) => void,
): Promise<void> {
  if (redirected) return Promise.resolve();
  running ??= (async () => {
    const me = await fetchMe();
    if (redirected) return;
    if (me === 'unauthenticated') {
      redirected = true;
      // The socket still holds the dead session; the next login opens a fresh one.
      closeSocket();
      // Leave first so no mounted query refetches (and 401s) while the cache is emptied.
      navigate('/entrar?motivo=reinicio', { replace: true });
      qc.clear();
      return;
    }
    // The server closes every socket after a reset: open it again (a no-op when connected).
    getSocket();
    if (me !== 'failed') {
      const cached = qc.getQueryData<MeDto>(ME_KEY);
      if (cached && cached.user.id !== me.user.id) qc.clear();
      qc.setQueryData(ME_KEY, me);
    }
    // `me` was just fetched; the rest refetches reusing fetches already in flight.
    await qc.invalidateQueries(
      { predicate: (q) => q.queryKey[0] !== ME_KEY[0] },
      { cancelRefetch: false },
    );
  })().finally(() => {
    running = undefined;
  });
  return running;
}

/**
 * Mount in the signed-in shell. On `demo:reset` and on every socket RE-connection (not the first
 * one: queries just loaded) runs `recoverSession`. Mounting re-arms the redirect guard, which is
 * what "the user signed in again" means.
 */
export function useDemoRecovery(): void {
  const qc = useQueryClient();
  const navigate = useNavigate();
  // `navigate` changes identity on route changes: keep it out of the deps so the effect (and
  // its first-connect bookkeeping) does not restart.
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  useEffect(() => {
    redirected = false;
    const socket = getSocket();
    let connectedBefore = socket.connected;
    const recover = () => void recoverSession(qc, (to, opts) => navigateRef.current(to, opts));
    const onConnect = () => {
      if (connectedBefore) recover();
      connectedBefore = true;
    };
    socket.on('demo:reset', recover);
    socket.on('connect', onConnect);
    return () => {
      socket.off('demo:reset', recover);
      socket.off('connect', onConnect);
    };
  }, [qc]);
}
