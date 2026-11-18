import type { MailMessage, MailTransport } from '../transport';

/**
 * Brevo's transactional email API. Render's free plan blocks outbound SMTP (25/465/587), so real
 * delivery goes over HTTPS instead of the SMTP relay.
 */
export const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';

const DEFAULT_TIMEOUT_MS = 10_000;

export interface BrevoOptions {
  /** API key from Brevo → SMTP & API → API Keys. */
  apiKey: string;
  /** `MAIL_FROM`: `Name <address>` or a bare address (a sender verified in Brevo). */
  from: string;
  timeoutMs?: number;
}

export interface Sender {
  email: string;
  name?: string;
}

/** `Kanban <yo@example.com>` → `{ name: 'Kanban', email: 'yo@example.com' }`. */
export function parseSender(from: string): Sender {
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(from);
  if (!m) return { email: from.trim() };
  const name = m[1]!.trim();
  const email = m[2]!.trim();
  return name ? { name, email } : { email };
}

/** `MAIL_TRANSPORT=brevo`: one `POST` per email; any non-2xx or timeout throws (pg-boss retries). */
export class BrevoTransport implements MailTransport {
  private readonly sender: Sender;

  constructor(private readonly opts: BrevoOptions) {
    this.sender = parseSender(opts.from);
  }

  async send(msg: MailMessage): Promise<void> {
    const body = {
      sender: this.sender,
      to: [{ email: msg.to }],
      subject: msg.subject,
      htmlContent: msg.html,
      textContent: msg.text,
      ...(msg.unsubscribeUrl ? { headers: { 'List-Unsubscribe': `<${msg.unsubscribeUrl}>` } } : {}),
    };
    const res = await fetch(BREVO_API_URL, {
      method: 'POST',
      headers: {
        'api-key': this.opts.apiKey,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
    if (!res.ok) {
      // The error body is Brevo's `{code, message}`: no secrets, useful in the logs.
      const detail = (await res.text().catch(() => '')).slice(0, 300);
      throw new Error(`Brevo API ${res.status}: ${detail}`);
    }
  }
}
