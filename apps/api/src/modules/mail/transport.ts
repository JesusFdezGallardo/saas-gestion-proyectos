import type { Config } from '../../config';
import { NullTransport } from './transports/none';
import { BrevoTransport } from './transports/brevo';
import { SmtpTransport } from './transports/smtp';

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** One-click unsubscribe link, sent as the `List-Unsubscribe` header where supported. */
  unsubscribeUrl?: string;
}

export interface MailTransport {
  send(msg: MailMessage): Promise<void>;
}

/** Test double: remembers what would have been sent. */
export class RecordingTransport implements MailTransport {
  readonly sent: MailMessage[] = [];
  send(msg: MailMessage): Promise<void> {
    this.sent.push(msg);
    return Promise.resolve();
  }
}

export { NullTransport };

/** The transport selected by `MAIL_TRANSPORT`: `none`, `smtp` (Mailpit) or `brevo` (HTTPS API). */
export function createTransport(
  config: Pick<Config, 'mailTransport' | 'smtp' | 'mailFrom' | 'brevoApiKey'>,
): MailTransport {
  const { smtp, mailFrom } = config;
  switch (config.mailTransport) {
    case 'none':
      return new NullTransport();
    case 'smtp':
      return new SmtpTransport({ ...smtp, from: mailFrom, requireTls: false });
    case 'brevo':
      return new BrevoTransport({ apiKey: config.brevoApiKey, from: mailFrom });
  }
}
