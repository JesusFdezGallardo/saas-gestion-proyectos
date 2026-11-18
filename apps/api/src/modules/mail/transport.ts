export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
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

/** Transport that sends nothing (`MAIL_TRANSPORT=none`, and the default until real ones exist). */
export class NullTransport implements MailTransport {
  send(): Promise<void> {
    return Promise.resolve();
  }
}
