import nodemailer, { type Transporter } from 'nodemailer';
import type { MailMessage, MailTransport } from '../transport';

export interface SmtpOptions {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
  /** Upgrade with STARTTLS and refuse to send in clear text (Brevo on 587). */
  requireTls: boolean;
}

/** Brevo's SMTP relay: port 587 with STARTTLS; the login and SMTP key come from its dashboard. */
export const BREVO_SMTP = { host: 'smtp-relay.brevo.com', port: 587 } as const;

/** SMTP through Nodemailer: Mailpit locally (`smtp`) or Brevo's relay (`brevo`). */
export class SmtpTransport implements MailTransport {
  private readonly transporter: Transporter;

  constructor(private readonly opts: SmtpOptions) {
    this.transporter = nodemailer.createTransport({
      host: opts.host,
      port: opts.port,
      secure: false, // 587/1025: plain connection, upgraded with STARTTLS when offered/required
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
    });
  }
}
