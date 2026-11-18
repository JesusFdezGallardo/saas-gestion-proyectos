import { createHmac, timingSafeEqual } from 'node:crypto';
import type { NotificationDto } from '@kanban/shared';

export interface InvitationPayload {
  orgName: string;
  link: string;
  inviterName: string;
}

export type EmailJobData =
  | { kind: 'notification'; toEmail: string; actorId: string; payload: NotificationDto }
  | { kind: 'invitation'; toEmail: string; actorId: string; payload: InvitationPayload };

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export interface TemplateOptions {
  appOrigin: string;
  unsubscribeSecret: string;
}

const PRODUCT = 'Kanban';

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Subjects are one line: user text must not smuggle header breaks. */
const oneLine = (s: string): string => s.replace(/[\r\n]+/g, ' ').trim();

const normalize = (email: string): string => email.trim().toLowerCase();

/** HMAC-SHA256 of the (lower-cased) address, base64url. */
export function unsubscribeToken(email: string, secret: string): string {
  return createHmac('sha256', secret).update(normalize(email)).digest('base64url');
}

/** Constant-time check of an unsubscribe token. */
export function verifyUnsubscribeToken(email: string, token: string, secret: string): boolean {
  const expected = Buffer.from(unsubscribeToken(email, secret));
  const given = Buffer.from(token);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export function unsubscribeUrl(email: string, opts: TemplateOptions): string {
  const url = new URL('/api/mail/unsubscribe', opts.appOrigin);
  url.searchParams.set('e', normalize(email));
  url.searchParams.set('t', unsubscribeToken(email, opts.unsubscribeSecret));
  return url.toString();
}

export function cardUrl(n: NotificationDto, appOrigin: string): string {
  const url = new URL(`/o/${n.orgId}/p/${n.projectId}`, appOrigin);
  url.searchParams.set('card', n.cardId);
  return url.toString();
}

interface Content {
  subject: string;
  /** Plain-text sentence (user text raw). */
  line: string;
  /** Same sentence for the HTML part (user text escaped). */
  lineHtml: string;
  action: string;
  link: string;
  note?: string;
}

function notificationContent(n: NotificationDto, appOrigin: string): Content {
  const title = `«${n.cardTitle}»`;
  const titleHtml = `«<strong>${escapeHtml(n.cardTitle)}</strong>»`;
  const actor = n.actorName || 'Alguien';
  const actorHtml = escapeHtml(actor);
  const link = cardUrl(n, appOrigin);
  const action = 'Abrir la tarjeta';
  switch (n.type) {
    case 'mention':
      return {
        subject: `${actor} te ha mencionado en ${title}`,
        line: `${actor} te ha mencionado en un comentario de la tarjeta ${title}.`,
        lineHtml: `${actorHtml} te ha mencionado en un comentario de la tarjeta ${titleHtml}.`,
        action,
        link,
      };
    case 'assigned':
      return {
        subject: `Te han asignado ${title}`,
        line: `${actor} te ha asignado la tarjeta ${title}.`,
        lineHtml: `${actorHtml} te ha asignado la tarjeta ${titleHtml}.`,
        action,
        link,
      };
    case 'comment':
      return {
        subject: `Nuevo comentario en ${title}`,
        line: `${actor} ha comentado en la tarjeta ${title}, que tienes asignada.`,
        lineHtml: `${actorHtml} ha comentado en la tarjeta ${titleHtml}, que tienes asignada.`,
        action,
        link,
      };
  }
}

function invitationContent(p: InvitationPayload): Content {
  const inviter = p.inviterName || 'Alguien';
  return {
    subject: `Te han invitado a ${p.orgName}`,
    line: `${inviter} te ha invitado a unirte a «${p.orgName}» en ${PRODUCT}.`,
    lineHtml: `${escapeHtml(inviter)} te ha invitado a unirte a «<strong>${escapeHtml(p.orgName)}</strong>» en ${PRODUCT}.`,
    action: 'Aceptar la invitación',
    link: p.link,
    note: 'El enlace caduca en 7 días. Para aceptarla, entra o regístrate con esta misma dirección.',
  };
}

const FOOTER = `Recibes esto porque te registraste o te invitaron en la demo de ${PRODUCT}.`;

/** Subject, HTML and text of an email (Spanish). Every user-provided string is escaped in HTML. */
export function renderEmail(data: EmailJobData, opts: TemplateOptions): RenderedEmail {
  const c =
    data.kind === 'notification'
      ? notificationContent(data.payload, opts.appOrigin)
      : invitationContent(data.payload);
  const unsubscribe = unsubscribeUrl(data.toEmail, opts);

  const text = [
    c.line,
    '',
    `${c.action}: ${c.link}`,
    ...(c.note ? ['', c.note] : []),
    '',
    '--',
    FOOTER,
    `Para no recibir más correos: ${unsubscribe}`,
  ].join('\n');

  const html = `<!doctype html>
<html lang="es">
<body style="margin:0;padding:24px;background:#f4f5f7;font-family:Arial,Helvetica,sans-serif;color:#172b4d">
<div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:8px;padding:24px">
<p style="font-size:16px;line-height:1.5;margin:0 0 20px">${c.lineHtml}</p>
<p style="margin:0 0 20px"><a href="${escapeHtml(c.link)}" style="display:inline-block;background:#0c66e4;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:4px">${escapeHtml(c.action)}</a></p>
${c.note ? `<p style="font-size:14px;color:#44546f;margin:0 0 20px">${escapeHtml(c.note)}</p>` : ''}
<hr style="border:none;border-top:1px solid #dfe1e6;margin:20px 0">
<p style="font-size:12px;color:#626f86;margin:0">${escapeHtml(FOOTER)}<br><a href="${escapeHtml(unsubscribe)}" style="color:#626f86">No quiero recibir más correos</a></p>
</div>
</body>
</html>`;

  return { subject: oneLine(c.subject), html, text };
}
