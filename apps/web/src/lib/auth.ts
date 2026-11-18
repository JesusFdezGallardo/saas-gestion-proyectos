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

/** Only same-site paths: never follow `?volver=` to another origin. */
export function safeReturnPath(value: string | null): string | null {
  return value && value.startsWith('/') && !value.startsWith('//') ? value : null;
}
