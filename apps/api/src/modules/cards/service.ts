import {
  comparePositions,
  positionBetween,
  type CardDto,
  type CreateCardInput,
  type EventMeta,
  type MoveCardInput,
  type UpdateCardInput,
} from '@kanban/shared';
import { and, count, eq, inArray } from 'drizzle-orm';
import { cardLabels, cards, columns, comments, labels, memberships } from '../../db/schema';
import { resolveNeighbourPosition } from '../../db/neighbours';
import { withOrgTx, type Tx, type TxCtx } from '../../db/tx';
import { AppError } from '../../http/errors';
import type { RealtimeBus } from '../../realtime/bus';
import { lockProject } from '../columns/service';

const cardNotFound = () => new AppError(404, 'not_found', 'Card not found');
const columnNotFound = () => new AppError(404, 'not_found', 'Column not found');

/**
 * Hook called inside the transaction whenever a card's assignee changes (also on creation, with
 * `previousAssigneeId` null). No-op until Task 12 creates the "assigned" notification here.
 */
/* eslint-disable @typescript-eslint/no-unused-vars -- no-op hook, implemented in Task 12 */
export function onAssigneeChanged(
  _ctx: TxCtx,
  _card: CardDto,
  _previousAssigneeId: string | null,
  _actorId: string,
): Promise<void> {
  return Promise.resolve();
}
/* eslint-enable @typescript-eslint/no-unused-vars */

type CardRow = typeof cards.$inferSelect;

export function toCardDto(row: CardRow, labelIds: string[], commentCount = 0): CardDto {
  return {
    id: row.id,
    projectId: row.projectId,
    columnId: row.columnId,
    title: row.title,
    description: row.description,
    assigneeId: row.assigneeId,
    dueDate: row.dueDate,
    position: row.position,
    labelIds,
    createdBy: row.createdBy,
    commentCount,
  };
}

export async function commentCountOf(tx: Tx, cardId: string): Promise<number> {
  const [row] = await tx.select({ n: count() }).from(comments).where(eq(comments.cardId, cardId));
  return row?.n ?? 0;
}

export async function labelIdsOf(tx: Tx, cardId: string): Promise<string[]> {
  const rows = await tx
    .select({ labelId: cardLabels.labelId })
    .from(cardLabels)
    .where(eq(cardLabels.cardId, cardId));
  return rows.map((r) => r.labelId).sort();
}

async function assertAssignee(tx: Tx, orgId: string, userId: string): Promise<void> {
  const [m] = await tx
    .select({ id: memberships.id })
    .from(memberships)
    .where(and(eq(memberships.organizationId, orgId), eq(memberships.userId, userId)));
  if (!m) throw new AppError(422, 'validation', 'assigneeId: not a member of this organization');
}

async function assertLabels(
  tx: Tx,
  orgId: string,
  projectId: string,
  labelIds: string[],
): Promise<string[]> {
  const unique = [...new Set(labelIds)];
  if (unique.length === 0) return unique;
  const found = await tx
    .select({ id: labels.id })
    .from(labels)
    .where(
      and(
        eq(labels.organizationId, orgId),
        eq(labels.projectId, projectId),
        inArray(labels.id, unique),
      ),
    );
  if (found.length !== unique.length) {
    throw new AppError(422, 'validation', 'labelIds: unknown label for this project');
  }
  return unique;
}

async function setLabels(tx: Tx, orgId: string, cardId: string, labelIds: string[]): Promise<void> {
  await tx.delete(cardLabels).where(eq(cardLabels.cardId, cardId));
  if (labelIds.length > 0) {
    await tx
      .insert(cardLabels)
      .values(labelIds.map((labelId) => ({ organizationId: orgId, cardId, labelId })));
  }
}

async function columnCards(tx: Tx, columnId: string): Promise<CardRow[]> {
  const rows = await tx.select().from(cards).where(eq(cards.columnId, columnId));
  return rows.sort(comparePositions);
}

/** Finds a card, locks its project and re-reads it under the lock (it may be deleted meanwhile). */
export async function lockedCard(tx: Tx, orgId: string, cardId: string): Promise<CardRow> {
  const [first] = await tx
    .select({ projectId: cards.projectId })
    .from(cards)
    .where(and(eq(cards.id, cardId), eq(cards.organizationId, orgId)));
  if (!first) throw cardNotFound();
  await lockProject(tx, orgId, first.projectId);
  const [current] = await tx
    .select()
    .from(cards)
    .where(and(eq(cards.id, cardId), eq(cards.organizationId, orgId)));
  if (!current) throw cardNotFound();
  return current;
}

export function createCard(
  bus: RealtimeBus,
  meta: EventMeta,
  orgId: string,
  columnId: string,
  input: CreateCardInput,
): Promise<CardDto> {
  return withOrgTx(meta.actorId, orgId, async (ctx) => {
    const { tx, afterCommit } = ctx;
    const [first] = await tx
      .select({ projectId: columns.projectId })
      .from(columns)
      .where(and(eq(columns.id, columnId), eq(columns.organizationId, orgId)));
    if (!first) throw columnNotFound();
    await lockProject(tx, orgId, first.projectId);
    const [column] = await tx
      .select()
      .from(columns)
      .where(and(eq(columns.id, columnId), eq(columns.organizationId, orgId)));
    if (!column) throw columnNotFound(); // deleted meanwhile

    const assigneeId = input.assigneeId ?? null;
    if (assigneeId) await assertAssignee(tx, orgId, assigneeId);
    const labelIds = await assertLabels(tx, orgId, column.projectId, input.labelIds ?? []);

    const siblings = await columnCards(tx, columnId);
    const [row] = await tx
      .insert(cards)
      .values({
        organizationId: orgId,
        projectId: column.projectId,
        columnId,
        title: input.title,
        description: input.description ?? '',
        assigneeId,
        dueDate: input.dueDate ?? null,
        position: positionBetween(siblings[siblings.length - 1]?.position ?? null, null),
        createdBy: meta.actorId,
      })
      .returning();
    if (!row) throw new Error('card insert returned no row');
    await setLabels(tx, orgId, row.id, labelIds);
    const card = toCardDto(row, [...labelIds].sort());
    if (assigneeId) await onAssigneeChanged(ctx, card, null, meta.actorId);
    afterCommit(() => bus.toBoard(orgId, card.projectId, { type: 'card.created', card, meta }));
    return card;
  });
}

export function updateCard(
  bus: RealtimeBus,
  meta: EventMeta,
  orgId: string,
  cardId: string,
  input: UpdateCardInput,
): Promise<CardDto> {
  return withOrgTx(meta.actorId, orgId, async (ctx) => {
    const { tx, afterCommit } = ctx;
    const current = await lockedCard(tx, orgId, cardId);

    const patch: Partial<typeof cards.$inferInsert> = {};
    if (input.title !== undefined) patch.title = input.title;
    if (input.description !== undefined) patch.description = input.description;
    if (input.dueDate !== undefined) patch.dueDate = input.dueDate;
    if (input.assigneeId !== undefined) {
      if (input.assigneeId) await assertAssignee(tx, orgId, input.assigneeId);
      patch.assigneeId = input.assigneeId;
    }
    let labelIds: string[] | undefined;
    if (input.labelIds !== undefined) {
      labelIds = await assertLabels(tx, orgId, current.projectId, input.labelIds);
    }

    let row = current;
    if (Object.keys(patch).length > 0) {
      const [updated] = await tx.update(cards).set(patch).where(eq(cards.id, cardId)).returning();
      if (!updated) throw cardNotFound();
      row = updated;
    }
    if (labelIds) await setLabels(tx, orgId, cardId, labelIds);
    const card = toCardDto(
      row,
      labelIds ? [...labelIds].sort() : await labelIdsOf(tx, cardId),
      await commentCountOf(tx, cardId),
    );
    if (input.assigneeId !== undefined && row.assigneeId !== current.assigneeId) {
      await onAssigneeChanged(ctx, card, current.assigneeId, meta.actorId);
    }
    afterCommit(() => bus.toBoard(orgId, card.projectId, { type: 'card.updated', card, meta }));
    return card;
  });
}

export function moveCard(
  bus: RealtimeBus,
  meta: EventMeta,
  orgId: string,
  cardId: string,
  input: MoveCardInput,
): Promise<CardDto> {
  return withOrgTx(meta.actorId, orgId, async ({ tx, afterCommit }) => {
    const current = await lockedCard(tx, orgId, cardId);
    const [target] = await tx
      .select({ id: columns.id })
      .from(columns)
      .where(
        and(
          eq(columns.id, input.toColumnId),
          eq(columns.organizationId, orgId),
          eq(columns.projectId, current.projectId),
        ),
      );
    if (!target) throw columnNotFound();

    const siblings = (await columnCards(tx, target.id)).filter((c) => c.id !== cardId);
    const position = resolveNeighbourPosition(siblings, input.beforeId, input.afterId);
    const [updated] = await tx
      .update(cards)
      .set({ columnId: target.id, position })
      .where(eq(cards.id, cardId))
      .returning();
    if (!updated) throw cardNotFound();
    const card = toCardDto(updated, await labelIdsOf(tx, cardId), await commentCountOf(tx, cardId));
    afterCommit(() => bus.toBoard(orgId, card.projectId, { type: 'card.moved', card, meta }));
    return card;
  });
}

export function deleteCard(
  bus: RealtimeBus,
  meta: EventMeta,
  orgId: string,
  cardId: string,
): Promise<void> {
  return withOrgTx(meta.actorId, orgId, async ({ tx, afterCommit }) => {
    const current = await lockedCard(tx, orgId, cardId);
    await tx.delete(cards).where(eq(cards.id, cardId));
    afterCommit(() =>
      bus.toBoard(orgId, current.projectId, { type: 'card.deleted', cardId, meta }),
    );
  });
}
