import type { MailboxEntryDto } from '@kanban/shared';
import { desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { systemDb } from '../../db/client';
import { systemOp } from '../../db/errors';
import { emailBlocklist, mailbox, userSettings, users } from '../../db/schema';
import { withUserTx } from '../../db/tx';
import { requireUser } from '../../http/auth-guard';
import { escapeHtml, verifyUnsubscribeToken } from './templates';

export const MAILBOX_LIMIT = 50;

/** The session user's emails (by address), newest first. */
export function listMailbox(userId: string, email: string): Promise<MailboxEntryDto[]> {
  return withUserTx(userId, async ({ tx }) => {
    const rows = await tx
      .select()
      .from(mailbox)
      .where(eq(mailbox.toEmail, email))
      .orderBy(desc(mailbox.createdAt), desc(mailbox.id))
      .limit(MAILBOX_LIMIT);
    return rows.map((r) => ({
      id: r.id,
      subject: r.subject,
      html: r.html,
      text: r.text,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
    }));
  });
}

/**
 * No more emails to `email`: turns off the account's email notifications or, without an account,
 * blocklists the address. Idempotent.
 */
export async function unsubscribe(email: string): Promise<void> {
  await systemOp(() =>
    systemDb.transaction(async (tx) => {
      const [u] = await tx.select({ id: users.id }).from(users).where(eq(users.email, email));
      if (u) {
        await tx
          .insert(userSettings)
          .values({ userId: u.id, emailNotifications: false })
          .onConflictDoUpdate({ target: userSettings.userId, set: { emailNotifications: false } });
      } else {
        await tx.insert(emailBlocklist).values({ email }).onConflictDoNothing();
      }
    }),
  );
}

const page = (title: string, body: string): string => `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title></head>
<body style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:48px auto;padding:0 16px;color:#172b4d">
<h1 style="font-size:20px">${escapeHtml(title)}</h1><p>${body}</p></body></html>`;

export function mailRoutes(app: FastifyInstance): void {
  app.get('/api/mailbox', { preHandler: requireUser }, (req) =>
    listMailbox(req.user.id, req.user.email),
  );

  app.get('/api/mail/unsubscribe', async (req, reply) => {
    const q = z
      .object({ e: z.email().max(254), t: z.string().min(1).max(200) })
      .safeParse(req.query);
    const ok =
      q.success && verifyUnsubscribeToken(q.data.e, q.data.t, app.config.unsubscribeSecret);
    reply.type('text/html; charset=utf-8');
    if (!q.success || !ok) {
      return reply
        .status(400)
        .send(page('Enlace no válido', 'Este enlace para darte de baja no es válido.'));
    }
    const email = q.data.e.trim().toLowerCase();
    await unsubscribe(email);
    return page(
      'Te has dado de baja',
      `No recibirás más correos de esta demo en <strong>${escapeHtml(email)}</strong>.`,
    );
  });
}
