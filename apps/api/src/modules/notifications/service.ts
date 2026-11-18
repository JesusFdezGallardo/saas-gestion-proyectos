import type { NotificationDto, UpdateSettingsInput } from '@kanban/shared';
import { randomUUID } from 'node:crypto';
import { and, count, desc, eq, inArray, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import { cards, memberships, notifications, userSettings, users } from '../../db/schema';
import { withUserTx, type Tx, type TxCtx } from '../../db/tx';
import { AppError } from '../../http/errors';
import { enqueueEmail } from '../mail/queue';
import type { RealtimeBus } from '../../realtime/bus';

export const NOTIFICATIONS_PAGE_SIZE = 20;

export interface NotificationItem {
  userId: string;
  type: NotificationDto['type'];
  actorId: string;
  cardId: string;
  commentId?: string | null;
}

/**
 * Queues the email of a notification in the same transaction. Always queued: the worker checks the
 * recipient's `email_notifications` (the actor cannot read other users' settings under RLS) and
 * drops the job when it is off.
 */
export function enqueueNotificationEmail(
  ctx: TxCtx,
  toEmail: string,
  n: NotificationDto,
): Promise<void> {
  return enqueueEmail(ctx, { kind: 'notification', toEmail, actorId: n.actorId, payload: n });
}

/**
 * Creates notifications inside the caller's transaction (an org transaction of the actor).
 * Drops the actor and anyone who is not a current member of the card's organization, inserts
 * without RETURNING (the actor cannot SELECT other users' rows; ids and `created_at` are
 * generated here so the DTO is exact) and, after commit, emits `notification.created` to each
 * recipient. Returns the DTOs that were created.
 */
export async function createNotifications(
  ctx: TxCtx,
  bus: RealtimeBus,
  items: NotificationItem[],
): Promise<NotificationDto[]> {
  const { tx, afterCommit } = ctx;
  // one notification per (recipient, type, card, comment)
  const unique = new Map<string, NotificationItem>();
  for (const it of items) {
    if (it.userId === it.actorId) continue;
    unique.set(`${it.userId}|${it.type}|${it.cardId}|${it.commentId ?? ''}`, it);
  }
  if (unique.size === 0) return [];

  const byCard = new Map<string, NotificationItem[]>();
  for (const it of unique.values()) byCard.set(it.cardId, [...(byCard.get(it.cardId) ?? []), it]);

  const created: Array<{ userId: string; dto: NotificationDto }> = [];
  for (const [cardId, group] of byCard) {
    const [card] = await tx
      .select({ orgId: cards.organizationId, projectId: cards.projectId, title: cards.title })
      .from(cards)
      .where(eq(cards.id, cardId)); // RLS: only the actor's current organization
    if (!card) continue;
    const memberRows = await tx
      .select({ userId: memberships.userId })
      .from(memberships)
      .where(
        and(
          eq(memberships.organizationId, card.orgId),
          inArray(memberships.userId, [...new Set(group.map((g) => g.userId))]),
        ),
      );
    const members = new Set(memberRows.map((m) => m.userId));
    const actorRows = await tx
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(inArray(users.id, [...new Set(group.map((g) => g.actorId))]));
    const actorName = new Map(actorRows.map((a) => [a.id, a.name]));

    for (const it of group) {
      if (!members.has(it.userId)) continue;
      created.push({
        userId: it.userId,
        dto: {
          id: randomUUID(),
          type: it.type,
          orgId: card.orgId,
          projectId: card.projectId,
          cardId,
          cardTitle: card.title,
          actorId: it.actorId,
          actorName: actorName.get(it.actorId) ?? '',
          commentId: it.commentId ?? null,
          readAt: null,
          createdAt: new Date().toISOString(),
        },
      });
    }
  }
  if (created.length === 0) return [];

  await tx.insert(notifications).values(
    created.map(({ userId, dto }) => ({
      id: dto.id,
      organizationId: dto.orgId,
      userId,
      type: dto.type,
      actorId: dto.actorId,
      cardId: dto.cardId,
      commentId: dto.commentId,
      createdAt: new Date(dto.createdAt),
    })),
  );
  const emails = await tx
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(inArray(users.id, [...new Set(created.map((c) => c.userId))]));
  const emailOf = new Map(emails.map((u) => [u.id, u.email]));
  for (const { userId, dto } of created) {
    const to = emailOf.get(userId);
    if (to) await enqueueNotificationEmail(ctx, to, dto);
  }
  afterCommit(() => {
    for (const { userId, dto } of created) {
      bus.toUser(userId, {
        type: 'notification.created',
        notification: dto,
        meta: { actorId: dto.actorId },
      });
    }
  });
  return created.map((c) => c.dto);
}

// ------------------------------------------------------------------ reading (user scoped)

type Row = typeof notifications.$inferSelect;

export interface Cursor {
  at: Date;
  id: string | null;
}

/**
 * Cursor of `GET /api/notifications?before=`: `<iso>|<id>` (the createdAt and id of the last
 * item of the previous page) or just `<iso>`. Ordering is (created_at desc, id desc) so rows
 * sharing a timestamp are neither skipped nor repeated.
 */
export function parseCursor(raw: string | undefined): Cursor | null {
  if (raw === undefined) return null;
  const [iso = '', id] = raw.split('|');
  const at = new Date(iso);
  const idOk = id === undefined || /^[0-9a-f-]{36}$/i.test(id);
  if (Number.isNaN(at.getTime()) || !idOk) {
    throw new AppError(422, 'validation', 'before: invalid cursor');
  }
  return { at, id: id ?? null };
}

/** Rows of the organizations the user currently belongs to (the bell is cross-org). */
const memberOf = (userId: string): SQL =>
  sql`${notifications.organizationId} in (select ${memberships.organizationId} from ${memberships} where ${memberships.userId} = ${userId})`;

/**
 * Cards live under per-organization RLS, so the transaction switches `app.org_id` to each
 * organization of the page (the user is a current member of all of them) to read the card title
 * and project.
 */
async function toDtos(tx: Tx, userId: string, rows: Row[]): Promise<NotificationDto[]> {
  if (rows.length === 0) return [];
  const info = new Map<string, { title: string; projectId: string }>();
  // defensive: never switch to an organization the user is not a current member of
  const mine = await tx
    .select({ orgId: memberships.organizationId })
    .from(memberships)
    .where(eq(memberships.userId, userId));
  const memberOrgs = new Set(mine.map((m) => m.orgId));
  for (const orgId of new Set(rows.map((r) => r.organizationId))) {
    if (!memberOrgs.has(orgId)) continue;
    await tx.execute(sql`select set_config('app.org_id', ${orgId}, true)`);
    const ids = rows.filter((r) => r.organizationId === orgId).map((r) => r.cardId);
    const found = await tx
      .select({ id: cards.id, title: cards.title, projectId: cards.projectId })
      .from(cards)
      .where(and(eq(cards.organizationId, orgId), inArray(cards.id, ids)));
    for (const c of found) info.set(c.id, { title: c.title, projectId: c.projectId });
  }
  await tx.execute(sql`select set_config('app.org_id', '', true)`);
  const actors = await tx
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(inArray(users.id, [...new Set(rows.map((r) => r.actorId))]));
  const name = new Map(actors.map((a) => [a.id, a.name]));
  return rows.flatMap((r) => {
    const c = info.get(r.cardId);
    if (!c) return [];
    return [
      {
        id: r.id,
        type: r.type,
        orgId: r.organizationId,
        projectId: c.projectId,
        cardId: r.cardId,
        cardTitle: c.title,
        actorId: r.actorId,
        actorName: name.get(r.actorId) ?? '',
        commentId: r.commentId,
        readAt: r.readAt ? r.readAt.toISOString() : null,
        createdAt: r.createdAt.toISOString(),
      },
    ];
  });
}

export function listNotifications(
  userId: string,
  before: Cursor | null,
): Promise<NotificationDto[]> {
  return withUserTx(userId, async ({ tx }) => {
    const conds: SQL[] = [eq(notifications.userId, userId), memberOf(userId)];
    if (before) {
      const older = before.id
        ? or(
            lt(notifications.createdAt, before.at),
            and(eq(notifications.createdAt, before.at), lt(notifications.id, before.id)),
          )
        : lt(notifications.createdAt, before.at);
      if (older) conds.push(older);
    }
    const rows = await tx
      .select()
      .from(notifications)
      .where(and(...conds))
      .orderBy(desc(notifications.createdAt), desc(notifications.id))
      .limit(NOTIFICATIONS_PAGE_SIZE);
    return toDtos(tx, userId, rows);
  });
}

export function unreadCount(userId: string): Promise<number> {
  return withUserTx(userId, async ({ tx }) => {
    const [row] = await tx
      .select({ n: count() })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt), memberOf(userId)));
    return row?.n ?? 0;
  });
}

export function markRead(userId: string, id: string): Promise<NotificationDto> {
  return withUserTx(userId, async ({ tx }) => {
    // RLS hides other users' rows: they simply do not match. Already-read rows keep read_at.
    const updated = await tx
      .update(notifications)
      .set({ readAt: sql`coalesce(${notifications.readAt}, now())` })
      .where(and(eq(notifications.id, id), eq(notifications.userId, userId), memberOf(userId)))
      .returning();
    const row = updated[0];
    const [dto] = row ? await toDtos(tx, userId, [row]) : [];
    if (!dto) throw new AppError(404, 'not_found', 'Notification not found');
    return dto;
  });
}

export function markAllRead(userId: string): Promise<void> {
  return withUserTx(userId, async ({ tx }) => {
    await tx
      .update(notifications)
      .set({ readAt: sql`now()` })
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  });
}

// ------------------------------------------------------------------ settings

export function getSettings(userId: string): Promise<UpdateSettingsInput> {
  return withUserTx(userId, async ({ tx }) => {
    const [row] = await tx
      .select({ emailNotifications: userSettings.emailNotifications })
      .from(userSettings)
      .where(eq(userSettings.userId, userId));
    return { emailNotifications: row?.emailNotifications ?? true };
  });
}

export function updateSettings(
  userId: string,
  input: UpdateSettingsInput,
): Promise<UpdateSettingsInput> {
  return withUserTx(userId, async ({ tx }) => {
    await tx
      .insert(userSettings)
      .values({ userId, emailNotifications: input.emailNotifications })
      .onConflictDoUpdate({
        target: userSettings.userId,
        set: { emailNotifications: input.emailNotifications },
      });
    return { emailNotifications: input.emailNotifications };
  });
}
