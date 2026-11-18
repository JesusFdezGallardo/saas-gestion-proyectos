import { eq, sql } from 'drizzle-orm';
import type { JobWithMetadata } from 'pg-boss';
import { systemDb } from '../../db/client';
import { mailbox } from '../../db/schema';
import { EMAIL_QUEUE, getBoss } from './queue';
import { QUOTA_LIMITS, tryConsume, utcDay, type QuotaItem } from './quota';
import { renderEmail, unsubscribeUrl, type EmailJobData } from './templates';
import type { MailTransport } from './transport';

export type MailStatus = (typeof mailbox.$inferSelect)['status'];

/** The part of a pg-boss job the worker needs (`retryCount` of `retryLimit` tells the last try). */
export interface EmailJob {
  id: string;
  data: EmailJobData;
  retryCount: number;
  retryLimit: number;
}

export interface WorkerDeps {
  transport: MailTransport;
  /** Real delivery on (`MAIL_TRANSPORT` smtp/brevo); off = mailbox only. */
  deliver: boolean;
  appOrigin: string;
  unsubscribeSecret: string;
  log: { error(obj: object, msg: string): void; warn(obj: object, msg: string): void };
}

const DEMO_DOMAIN = '@demo.local';

/**
 * Mailbox row + delivery decision, in one owner transaction keyed by the job id (the row id), so a
 * retried job reuses its row and never takes quota twice. Returns the status, and whether to send.
 * `null` = the job is dropped (recipient turned email notifications off).
 */
async function storeAndDecide(
  job: EmailJob,
  deps: WorkerDeps,
): Promise<{ status: MailStatus; send: boolean } | null> {
  const { data } = job;
  return systemDb.transaction(async (tx) => {
    const [existing] = await tx
      .select({ status: mailbox.status })
      .from(mailbox)
      .where(eq(mailbox.id, job.id));
    if (existing)
      return { status: existing.status, send: deps.deliver && existing.status === 'stored' };

    const people = await tx.execute<{
      recipient_demo: boolean | null;
      email_notifications: boolean | null;
      actor_demo: boolean | null;
      blocked: boolean;
    }>(sql`
      select
        (select u.is_demo from users u where u.email = ${data.toEmail}) as recipient_demo,
        (select s.email_notifications from users u join user_settings s on s.user_id = u.id
          where u.email = ${data.toEmail}) as email_notifications,
        (select u.is_demo from users u where u.id = ${data.actorId}) as actor_demo,
        exists (select 1 from email_blocklist b where b.email = ${data.toEmail}) as blocked`);
    const p = people.rows[0];
    // The setting is checked here, not when enqueueing: the actor cannot read it under RLS.
    if (data.kind === 'notification' && p?.email_notifications === false) return null;

    const rendered = renderEmail(data, deps);
    let status: MailStatus = 'stored';
    let send = false;
    const demo =
      p?.recipient_demo === true ||
      p?.actor_demo === true ||
      data.toEmail.toLowerCase().endsWith(DEMO_DOMAIN);
    if (demo) status = 'skipped_demo';
    else if (p?.blocked) status = 'skipped_blocked';
    else if (deps.deliver) {
      const items: QuotaItem[] = [
        { scope: 'global', key: 'all', limit: QUOTA_LIMITS.global },
        { scope: 'recipient', key: data.toEmail.toLowerCase(), limit: QUOTA_LIMITS.recipient },
      ];
      if (data.kind === 'invitation') {
        items.push({ scope: 'inviter', key: data.actorId, limit: QUOTA_LIMITS.inviter });
      }
      if (await tryConsume(utcDay(), items, tx)) send = true;
      else status = 'skipped_limit';
    }
    await tx.insert(mailbox).values({
      id: job.id,
      toEmail: data.toEmail,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      status,
    });
    return { status, send };
  });
}

const setStatus = (id: string, status: MailStatus) =>
  systemDb.update(mailbox).set({ status }).where(eq(mailbox.id, id));

/**
 * Handles one email job: stores it in the mailbox (always, unless the recipient turned
 * notifications off), then sends it for real when allowed (not demo, not blocked, within the
 * daily limits, a real transport). A transport error is rethrown so pg-boss retries; on the last
 * attempt the mailbox row becomes `failed`. Returns the final status (`null` = dropped).
 */
export async function handleEmailJob(job: EmailJob, deps: WorkerDeps): Promise<MailStatus | null> {
  const decision = await storeAndDecide(job, deps);
  if (!decision) return null;
  if (!decision.send) return decision.status;

  const [row] = await systemDb
    .select({ subject: mailbox.subject, html: mailbox.html, text: mailbox.text })
    .from(mailbox)
    .where(eq(mailbox.id, job.id));
  if (!row) return null; // wiped meanwhile (demo reset)
  try {
    await deps.transport.send({
      to: job.data.toEmail,
      ...row,
      unsubscribeUrl: unsubscribeUrl(job.data.toEmail, deps),
    });
  } catch (err) {
    const last = job.retryCount >= job.retryLimit;
    deps.log.error(
      { err, jobId: job.id, attempt: job.retryCount + 1, last },
      last ? 'email delivery failed for good' : 'email delivery failed, will retry',
    );
    if (last) await setStatus(job.id, 'failed');
    throw err;
  }
  await setStatus(job.id, 'sent');
  return 'sent';
}

/** Starts the in-process worker (server only; tests call `handleEmailJob` / `drainEmailQueue`). */
export async function startEmailWorker(deps: WorkerDeps): Promise<void> {
  const boss = await getBoss({ supervise: true });
  await boss.work(
    EMAIL_QUEUE,
    { includeMetadata: true, batchSize: 1, pollingIntervalSeconds: 2 },
    async ([job]: Array<JobWithMetadata<EmailJobData>>) => {
      if (job) await handleEmailJob(job, deps);
    },
  );
}

/**
 * Processes every job ready right now, one by one, completing or failing each in pg-boss. For tests
 * and manual checks; returns how many jobs were handled.
 */
export async function drainEmailQueue(deps: WorkerDeps): Promise<number> {
  const boss = await getBoss();
  let handled = 0;
  for (;;) {
    const [job] = await boss.fetch<EmailJobData>(EMAIL_QUEUE, { includeMetadata: true });
    if (!job) return handled;
    handled++;
    try {
      await handleEmailJob(job, deps);
      await boss.complete(EMAIL_QUEUE, job.id);
    } catch (err) {
      await boss.fail(EMAIL_QUEUE, job.id, { message: String(err) });
    }
  }
}
