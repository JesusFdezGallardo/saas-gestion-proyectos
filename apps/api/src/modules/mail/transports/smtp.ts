import nodemailer, { type Transporter } from 'nodemailer';
import type { MailMessage, MailTransport } from '../transport';

export interface SmtpOptions {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
  /** Upgrade with STARTTLS and refuse to send in clear text. */
  requireTls: boolean;
}

/** SMTP through Nodemailer: Mailpit locally (`MAIL_TRANSPORT=smtp`). */
export class SmtpTransport implements MailTransport {
  private readonly transporter: Transporter;

  constructor(private readonly opts: SmtpOptions) {
    this.transporter = nodemailer.createTransport({
      host: opts.host,
      port: opts.port,
      secure: false, // plain connection (Mailpit on 1025), upgraded with STARTTLS when offered/required
      requireTLS: opts.requireTls,
      ...(opts.user ? { auth: { user: opts.user, pass: opts.pass } } : {}),
    });
  }

  async send(msg: MailMessage): Promise<void> {
    await this.transporter.sendMail({
      from: this.opts.from,
      to: msg.to,
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
      ...(msg.unsubscribeUrl ? { list: { unsubscribe: msg.unsubscribeUrl } } : {}),
    });
  }
}
