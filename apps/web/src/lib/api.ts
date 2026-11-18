export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ApiOptions {
  /** Sent as `X-Client-Mutation-Id` so the sender can recognise its own realtime echo. */
  mutationId?: string;
}

/** Pages where a 401 is expected (no session yet): never redirect from them. */
const AUTH_PATHS = [/^\/entrar(\/|$)/, /^\/registro(\/|$)/, /^\/invitacion\//];

export async function api<T = void>(
  method: string,
  path: string,
  body?: unknown,
  opts: ApiOptions = {},
): Promise<T> {
  const headers = new Headers();
  if (body !== undefined) headers.set('Content-Type', 'application/json');
  if (opts.mutationId) headers.set('X-Client-Mutation-Id', opts.mutationId);

  const res = await fetch(path, {
    method,
    headers,
    credentials: 'include',
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  if (res.ok) {
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  let code = 'internal_error';
  let message = res.statusText || 'Error inesperado';
  try {
    const data = (await res.json()) as { error?: { code?: string; message?: string } };
    if (data.error?.code) code = data.error.code;
    if (data.error?.message) message = data.error.message;
  } catch {
    // Not a JSON body (e.g. a proxy error page): keep the defaults.
  }

  if (res.status === 401 && !AUTH_PATHS.some((re) => re.test(globalThis.location.pathname))) {
    globalThis.location.assign('/entrar');
  }
  throw new ApiError(res.status, code, message);
}
