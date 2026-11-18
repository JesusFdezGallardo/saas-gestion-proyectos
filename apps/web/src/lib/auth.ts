import type { MeDto } from '@kanban/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from './api';

export const ME_KEY = ['me'] as const;

/** The single bootstrap query: 401 means "no session" and is not retried. */
export function useMe() {
  return useQuery({ queryKey: ME_KEY, queryFn: () => api<MeDto>('GET', '/api/auth/me') });
}

export function useSetMe() {
  const qc = useQueryClient();
  return (me: MeDto) => qc.setQueryData(ME_KEY, me);
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
    return url.pathname + url.search + url.hash;
  } catch {
    return null;
  }
}
