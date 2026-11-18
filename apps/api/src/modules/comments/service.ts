import { parseMentionIds, type CardDto, type CommentDto, type EventMeta } from '@kanban/shared';
import { z } from 'zod';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { cards, comments, mentions, memberships, users } from '../../db/schema';
import { withOrgTx, type Tx, type TxCtx } from '../../db/tx';
import { AppError } from '../../http/errors';
import type { RealtimeBus } from '../../realtime/bus';
import { createNotifications, type NotificationItem } from '../notifications/service';
import { commentCountOf, labelIdsOf, lockedCard, toCardDto } from '../cards/service';

/** The comment list of a card is capped (oldest first); no pagination needed at this scale. */
export const MAX_COMMENTS_PER_CARD = 200;

const commentNotFound = () => new AppError(404, 'not_found', 'Comment not found');
const cardNotFound = () => new AppError(404, 'not_found', 'Card not found');
const notAuthor = () =>
  new AppError(403, 'forbidden', 'Only the author can change or delete a comment');

export interface CommentNotifyInput {
  comment: CommentDto;
  card: CardDto;
  /** Valid (org member) mentions that were not on the comment before this write. */
  newMentionIds: string[];
  actorId: string;
  bus: RealtimeBus;
}

/**
 * Hook called inside the transaction on create (all valid mentions) and on edit (only the
 * mentions that were not there before). Mentioned users get "mention"; on create (not on edit)
 * the card's creator and assignee, if still org members, get "comment" unless they are the
 * author or already got the mention. Called through `commentHooks` so tests can observe it.
 */
export async function notifyForComment(ctx: TxCtx, input: CommentNotifyInput): Promise<void> {
  const { comment, card, newMentionIds, actorId, bus } = input;
  const base = { actorId, cardId: card.id, commentId: comment.id };
  const items: NotificationItem[] = newMentionIds.map((userId) => ({
    ...base,
    userId,
    type: 'mention',
  }));
  if (comment.editedAt === null) {
    const mentioned = new Set(newMentionIds);
    const others = new Set([card.createdBy, card.assigneeId].filter((u): u is string => !!u));
    for (const userId of others) {
      if (!mentioned.has(userId)) items.push({ ...base, userId, type: 'comment' });
    }
  }
  await createNotifications(ctx, bus, items);
}
export const commentHooks = { notifyForComment };

type CommentRow = typeof comments.$inferSelect;

const toCommentDto = (row: CommentRow, authorName: string): CommentDto => ({
  id: row.id,
  cardId: row.cardId,
  authorId: row.authorId,
  authorName,
  body: row.body,
  createdAt: row.createdAt.toISOString(),
  editedAt: row.editedAt ? row.editedAt.toISOString() : null,
});

async function authorNameOf(tx: Tx, userId: string): Promise<string> {
  const [u] = await tx.select({ name: users.name }).from(users).where(eq(users.id, userId));
  return u?.name ?? '';
}

/** Mentioned ids from the body that are current members of the org; the rest are dropped. */
async function validMentionIds(tx: Tx, orgId: string, body: string): Promise<string[]> {
  // defensive: a non-uuid would make Postgres fail the whole transaction
  const ids = parseMentionIds(body).filter((id) => z.uuid().safeParse(id).success);
  if (ids.length === 0) return [];
  const rows = await tx
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(and(eq(memberships.organizationId, orgId), inArray(memberships.userId, ids)));
  const members = new Set(rows.map((r) => r.userId));
  return ids.filter((id) => members.has(id));
}

async function cardDtoOf(tx: Tx, row: typeof cards.$inferSelect): Promise<CardDto> {
  return toCardDto(row, await labelIdsOf(tx, row.id), await commentCountOf(tx, row.id));
}

export function listComments(userId: string, orgId: string, cardId: string): Promise<CommentDto[]> {
  return withOrgTx(userId, orgId, async ({ tx }) => {
    const [card] = await tx
      .select({ id: cards.id })
      .from(cards)
      .where(and(eq(cards.id, cardId), eq(cards.organizationId, orgId)));
    if (!card) throw cardNotFound();
    const rows = await tx
      .select({ comment: comments, authorName: users.name })
      .from(comments)
      .innerJoin(users, eq(users.id, comments.authorId))
      .where(and(eq(comments.cardId, cardId), eq(comments.organizationId, orgId)))
      // The newest MAX_COMMENTS_PER_CARD, shown oldest first.
      .orderBy(desc(comments.createdAt), desc(comments.id))
      .limit(MAX_COMMENTS_PER_CARD);
    return rows.reverse().map((r) => toCommentDto(r.comment, r.authorName));
  });
}

export function createComment(
  bus: RealtimeBus,
  meta: EventMeta,
  orgId: string,
  cardId: string,
  body: string,
): Promise<CommentDto> {
  return withOrgTx(meta.actorId, orgId, async (ctx) => {
    const { tx, afterCommit } = ctx;
    const cardRow = await lockedCard(tx, orgId, cardId);
    const [row] = await tx
      .insert(comments)
      .values({ organizationId: orgId, cardId, authorId: meta.actorId, body })
      .returning();
    if (!row) throw new Error('comment insert returned no row');
    const mentionIds = await validMentionIds(tx, orgId, body);
    if (mentionIds.length > 0) {
      await tx
        .insert(mentions)
        .values(mentionIds.map((userId) => ({ organizationId: orgId, commentId: row.id, userId })));
    }
    const comment = toCommentDto(row, await authorNameOf(tx, meta.actorId));
    const card = await cardDtoOf(tx, cardRow);
    await commentHooks.notifyForComment(ctx, {
      comment,
      card,
      newMentionIds: mentionIds,
      actorId: meta.actorId,
      bus,
    });
    afterCommit(() => {
      bus.toBoard(orgId, card.projectId, { type: 'comment.created', comment, meta });
      bus.toBoard(orgId, card.projectId, { type: 'card.updated', card, meta });
    });
    return comment;
  });
}

/** Finds a comment of this org and its card (404 otherwise), locking the card's project. */
async function lockedComment(tx: Tx, orgId: string, commentId: string) {
  const [first] = await tx
    .select({ cardId: comments.cardId })
    .from(comments)
    .where(and(eq(comments.id, commentId), eq(comments.organizationId, orgId)));
  if (!first) throw commentNotFound();
  const cardRow = await lockedCard(tx, orgId, first.cardId);
  const [row] = await tx
    .select()
    .from(comments)
    .where(and(eq(comments.id, commentId), eq(comments.organizationId, orgId)));
  if (!row) throw commentNotFound(); // deleted meanwhile
  return { row, cardRow };
}

export function updateComment(
  bus: RealtimeBus,
  meta: EventMeta,
  orgId: string,
  commentId: string,
  body: string,
): Promise<CommentDto> {
  return withOrgTx(meta.actorId, orgId, async (ctx) => {
    const { tx, afterCommit } = ctx;
    const { row: current, cardRow } = await lockedComment(tx, orgId, commentId);
    if (current.authorId !== meta.actorId) throw notAuthor();

    const [updated] = await tx
      .update(comments)
      .set({ body, editedAt: new Date() })
      .where(eq(comments.id, commentId))
      .returning();
    if (!updated) throw commentNotFound();

    const before = (
      await tx
        .select({ userId: mentions.userId })
        .from(mentions)
        .where(eq(mentions.commentId, commentId))
    ).map((r) => r.userId);
    const now = await validMentionIds(tx, orgId, body);
    const removed = before.filter((id) => !now.includes(id));
    const added = now.filter((id) => !before.includes(id));
    if (removed.length > 0) {
      await tx
        .delete(mentions)
        .where(and(eq(mentions.commentId, commentId), inArray(mentions.userId, removed)));
    }
    if (added.length > 0) {
      await tx
        .insert(mentions)
        .values(added.map((userId) => ({ organizationId: orgId, commentId, userId })));
    }

    const comment = toCommentDto(updated, await authorNameOf(tx, updated.authorId));
    const card = await cardDtoOf(tx, cardRow);
    await commentHooks.notifyForComment(ctx, {
      comment,
      card,
      newMentionIds: added,
      actorId: meta.actorId,
      bus,
    });
    afterCommit(() =>
      bus.toBoard(orgId, card.projectId, { type: 'comment.updated', comment, meta }),
    );
    return comment;
  });
}

export function deleteComment(
  bus: RealtimeBus,
  meta: EventMeta,
  orgId: string,
  commentId: string,
): Promise<void> {
  return withOrgTx(meta.actorId, orgId, async ({ tx, afterCommit }) => {
    const { row: current, cardRow } = await lockedComment(tx, orgId, commentId);
    if (current.authorId !== meta.actorId) throw notAuthor();
    await tx.delete(comments).where(eq(comments.id, commentId));
    const card = await cardDtoOf(tx, cardRow);
    afterCommit(() => {
      bus.toBoard(orgId, card.projectId, {
        type: 'comment.deleted',
        commentId,
        cardId: card.id,
        meta,
      });
      bus.toBoard(orgId, card.projectId, { type: 'card.updated', card, meta });
    });
  });
}
