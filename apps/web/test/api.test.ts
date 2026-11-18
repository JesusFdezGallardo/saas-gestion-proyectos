import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '../src/lib/api';

function mockFetch(status: number, body?: unknown) {
  const fn = vi.fn(
    async () =>
      new Response(body === undefined ? null : JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
  );
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe('api()', () => {
  it('throws ApiError with code from body', async () => {
    mockFetch(409, { error: { code: 'conflict', message: 'Last admin' } });
    const err = await api('DELETE', '/api/orgs/o/members/u').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 409, code: 'conflict', message: 'Last admin' });
  });

  it('sends X-Client-Mutation-Id when given', async () => {
    const fn = mockFetch(200, { ok: true });
    await api('POST', '/api/x', { a: 1 }, { mutationId: 'm-1' });
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/x');
    expect(init.credentials).toBe('include');
    expect(init.body).toBe('{"a":1}');
    const headers = new Headers(init.headers);
    expect(headers.get('X-Client-Mutation-Id')).toBe('m-1');
    expect(headers.get('Content-Type')).toBe('application/json');
  });

  it('omits the mutation header and body when not given', async () => {
    const fn = mockFetch(200, {});
    await api('GET', '/api/x');
    const init = (fn.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(new Headers(init.headers).has('X-Client-Mutation-Id')).toBe(false);
    expect(init.body).toBeUndefined();
  });

  it('returns undefined on 204', async () => {
    mockFetch(204);
    await expect(api('POST', '/api/auth/logout')).resolves.toBeUndefined();
  });

  it('redirects to /entrar on 401 unless on an auth page', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { pathname: '/o/1', search: '', assign });
    mockFetch(401, { error: { code: 'unauthenticated', message: 'No session' } });
    await expect(api('GET', '/api/x')).rejects.toBeInstanceOf(ApiError);
    expect(assign).toHaveBeenCalledWith('/entrar');

    assign.mockClear();
    for (const path of ['/entrar', '/registro', '/invitacion/abc']) {
      vi.stubGlobal('location', { pathname: path, search: '', assign });
      await expect(api('GET', '/api/x')).rejects.toBeInstanceOf(ApiError);
    }
    expect(assign).not.toHaveBeenCalled();
  });

  it('survives a non-JSON error body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('Bad gateway', { status: 502 })),
    );
    await expect(api('GET', '/api/x')).rejects.toMatchObject({
      status: 502,
      code: 'internal_error',
    });
  });
});
