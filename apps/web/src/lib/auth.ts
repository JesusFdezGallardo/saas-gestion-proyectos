import type { MeDto } from '@kanban/shared';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api, ApiError } from './api';
import { closeSocket } from './socket';

export const ME_KEY = ['me'] as const;

/** The single bootstrap query: 401 means "no session" and is not retried. */
export function useMe() {
  return useQuery({ queryKey: ME_KEY, queryFn: () => api<MeDto>('GET', '/api/auth/me') });
}

export function useSetMe() {
  const qc = useQueryClient();
  return (me: MeDto) => qc.setQueryData(ME_KEY, me);
}

/**
 * After a successful login, register or demo login: forget everything of the previous user and
 * close the socket, whose handshake carried the old cookie (the next `getSocket()` opens a new one
 * as the new user).
 */
export function startSession(qc: QueryClient, me: MeDto): void {
  closeSocket();
  qc.clear();
  qc.setQueryData(ME_KEY, me);
}

/**
 * Signs out: ends the session on the server, closes the socket, goes to `to` and only then empties
 * the cache (leaving first, so no mounted query refetches and 401s meanwhile).
 */
export async function endSession(
  qc: QueryClient,
  navigate: (to: string, opts: { replace: boolean }) => void,
  to: string,
): Promise<void> {
  await api('POST', '/api/auth/logout').catch(() => undefined);
  closeSocket();
  navigate(to, { replace: true });
  qc.clear();
}

export const isUnauthenticated = (err: unknown): boolean =>
  err instanceof ApiError && err.status === 401;

/** Only same-origin paths: never follow `?volver=` to another site. */
export function safeReturnPath(value: string | null): string | null {
  if (!value || !value.startsWith('/')) return null;
  // Backslashes and control characters are normalised by browsers (`/\evil.com` -> `//evil.com`).
  // eslint-disable-next-line no-control-regex
  if (value.includes('\\') || /[\u0000-\u001f\u007f]/u.test(value)) return null;
  try {
    const base = globalThis.location.origin;
    const url = new URL(value, base);
    if (url.origin !== base) return null;
    // Dot segments can collapse into a protocol-relative path (`/.//evil.com` -> `//evil.com`).
    if (url.pathname.startsWith('//')) return null;
    return url.pathname + url.search + url.hash;
  } catch {
    return null;
  }
}
