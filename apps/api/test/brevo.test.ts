import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config';
import { createTransport } from '../src/modules/mail/transport';
import { BREVO_API_URL, BrevoTransport, parseSender } from '../src/modules/mail/transports/brevo';

const msg = {
  to: 'luis@example.com',
  subject: 'Te han asignado «Tarea»',
  html: '<p>Hola</p>',
  text: 'Hola',
  unsubscribeUrl: 'https://kanban.example.com/api/mail/unsubscribe?e=luis%40example.com&t=abc',
};

function mockFetch(impl: (url: string, init: RequestInit) => Promise<Response>) {
  const fn = vi.fn(impl);
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('parseSender', () => {
  it('splits a display name and an address', () => {
    expect(parseSender('Kanban <yo@example.com>')).toEqual({
      name: 'Kanban',
      email: 'yo@example.com',
    });
    expect(parseSender('"Kanban demo" <yo@example.com>')).toEqual({
      name: 'Kanban demo',
      email: 'yo@example.com',
    });
    expect(parseSender('yo@example.com')).toEqual({ email: 'yo@example.com' });
  });
});

describe('BrevoTransport', () => {
  it('posts the message to the Brevo API with the key header', async () => {
    const fetchMock = mockFetch(() =>
      Promise.resolve(new Response('{"messageId":"x"}', { status: 201 })),
    );
    const t = new BrevoTransport({ apiKey: 'key-123', from: 'Kanban <yo@example.com>' });
    await t.send(msg);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(BREVO_API_URL);
    expect(BREVO_API_URL).toBe('https://api.brevo.com/v3/smtp/email');
    expect(init.method).toBe('POST');
    const headers = new Headers(init.headers);
    expect(headers.get('api-key')).toBe('key-123');
    expect(headers.get('content-type')).toBe('application/json');
    expect(headers.get('accept')).toBe('application/json');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(init.body as string)).toEqual({
      sender: { name: 'Kanban', email: 'yo@example.com' },
      to: [{ email: 'luis@example.com' }],
      subject: msg.subject,
      htmlContent: msg.html,
      textContent: msg.text,
      headers: { 'List-Unsubscribe': `<${msg.unsubscribeUrl}>` },
    });
  });

  it('omits List-Unsubscribe when there is no link', async () => {
    const fetchMock = mockFetch(() => Promise.resolve(new Response('{}', { status: 201 })));
    const t = new BrevoTransport({ apiKey: 'k', from: 'yo@example.com' });
    await t.send({ to: 'a@example.com', subject: 's', html: 'h', text: 't' });
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string) as Record<string, unknown>;
    expect(body).not.toHaveProperty('headers');
    expect(body.sender).toEqual({ email: 'yo@example.com' });
  });

  it.each([400, 401, 429, 500, 503])('throws on HTTP %i so the job is retried', async (status) => {
    mockFetch(() => Promise.resolve(new Response('{"code":"bad"}', { status })));
    const t = new BrevoTransport({ apiKey: 'k', from: 'yo@example.com' });
    await expect(t.send(msg)).rejects.toThrow(new RegExp(`Brevo API ${status}`));
  });

  it('gives up after the timeout', async () => {
    mockFetch(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        }),
    );
    const t = new BrevoTransport({ apiKey: 'k', from: 'yo@example.com', timeoutMs: 20 });
    await expect(t.send(msg)).rejects.toThrow(/timed out|timeout|abort/i);
  });

  it('is what MAIL_TRANSPORT=brevo selects', () => {
    const config = loadConfig({
      DATABASE_URL: 'postgres://a:a@localhost:5432/x',
      DATABASE_URL_OWNER: 'postgres://a:a@localhost:5432/x',
      MAIL_TRANSPORT: 'brevo',
      BREVO_API_KEY: 'k',
    });
    expect(createTransport(config)).toBeInstanceOf(BrevoTransport);
  });
});
