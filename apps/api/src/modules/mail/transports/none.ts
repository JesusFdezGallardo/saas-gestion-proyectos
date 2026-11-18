import type { MailTransport } from '../transport';

/** `MAIL_TRANSPORT=none`: sends nothing; every email only lands in the in-app mailbox. */
export class NullTransport implements MailTransport {
  send(): Promise<void> {
    return Promise.resolve();
  }
}
