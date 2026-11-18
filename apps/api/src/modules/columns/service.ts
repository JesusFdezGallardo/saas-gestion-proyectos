import { comparePositions, positionBetween, type ColumnDto, type EventMeta } from '@kanban/shared';
import { and, eq } from 'drizzle-orm';
import { cards, columns, projects } from '../../db/schema';
import { withOrgTx, type Tx } from '../../db/tx';
import { AppError } from '../../http/errors';
import type { RealtimeBus } from '../../realtime/bus';
import { toColumnDto } from '../projects/service';

const colNotFound = () => new AppError(404, 'not_found', 'Column not found');

/** Locks the project row: serializes concurrent column edits of one board. */
async function lockProject(tx: Tx, orgId: string, projectId: string): Promise<void> {
  const [p] = await tx
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.organizationId, orgId)))
    .for('update');
  if (!p) throw new AppError(404, 'not_found', 'Project not found');
}

async function projectColumns(tx: Tx, projectId: string) {
  const rows = await tx.select().from(columns).where(eq(columns.projectId, projectId));
  return rows.sort(comparePositions);
}

export function createColumn(
  bus: RealtimeBus,
  meta: EventMeta,
  orgId: string,
  projectId: string,
  name: string,
): Promise<ColumnDto> {
  return withOrgTx(meta.actorId, orgId, async ({ tx, afterCommit }) => {
    await lockProject(tx, orgId, projectId);
    const existing = await projectColumns(tx, projectId);
    const last = existing[existing.length - 1];
    const [row] = await tx
      .insert(columns)
      .values({
        organizationId: orgId,
        projectId,
        name,
        position: positionBetween(last?.position ?? null, null),
      })
      .returning();
    if (!row) throw new Error('column insert returned no row');
    const column = toColumnDto(row);
    afterCommit(() => bus.toBoard(orgId, projectId, { type: 'column.created', column, meta }));
    return column;
  });
}

export interface UpdateColumn {
  name?: string | undefined;
  beforeId?: string | null | undefined;
  afterId?: string | null | undefined;
}

export function updateColumn(
  bus: RealtimeBus,
  meta: EventMeta,
  orgId: string,
  columnId: string,
  input: UpdateColumn,
): Promise<ColumnDto> {
  return withOrgTx(meta.actorId, orgId, async ({ tx, afterCommit }) => {
    const [current] = await tx
      .select()
      .from(columns)
      .where(and(eq(columns.id, columnId), eq(columns.organizationId, orgId)));
    if (!current) throw colNotFound();
    await lockProject(tx, orgId, current.projectId);

    const patch: { name?: string; position?: string } = {};
    if (input.name !== undefined) patch.name = input.name;

    if (input.beforeId !== undefined || input.afterId !== undefined) {
      // Neighbours are read inside the transaction; an id that is not another column of this
      // project (stale, foreign, the column itself) is ignored.
      const others = (await projectColumns(tx, current.projectId)).filter((c) => c.id !== columnId);
      const idx = (id: string | null | undefined) =>
        id ? others.findIndex((c) => c.id === id) : -1;
      const bi = idx(input.beforeId);
      const ai = idx(input.afterId);
      const lastPos = others[others.length - 1]?.position ?? null;
      let lower: string | null;
      let upper: string | null;
      if (bi >= 0 && ai >= 0) {
        lower = others[bi]!.position;
        upper = others[ai]!.position;
      } else if (bi >= 0) {
        lower = others[bi]!.position;
        upper = others[bi + 1]?.position ?? null;
      } else if (ai >= 0) {
        lower = others[ai - 1]?.position ?? null;
        upper = others[ai]!.position;
      } else {
        lower = lastPos;
        upper = null;
      }
      if (lower !== null && upper !== null && lower >= upper) {
        // Neighbours given in the wrong order: fall back to the end.
        lower = lastPos;
        upper = null;
      }
      patch.position = positionBetween(lower, upper);
    }

    let row = current;
    if (Object.keys(patch).length > 0) {
      const [updated] = await tx
        .update(columns)
        .set(patch)
        .where(eq(columns.id, columnId))
        .returning();
      if (!updated) throw colNotFound();
      row = updated;
    }
    const column = toColumnDto(row);
    afterCommit(() => bus.toBoard(orgId, row.projectId, { type: 'column.updated', column, meta }));
    return column;
  });
}

export function deleteColumn(
  bus: RealtimeBus,
  meta: EventMeta,
  orgId: string,
  columnId: string,
  moveTo: string | undefined,
): Promise<void> {
  return withOrgTx(meta.actorId, orgId, async ({ tx, afterCommit }) => {
    const [current] = await tx
      .select()
      .from(columns)
      .where(and(eq(columns.id, columnId), eq(columns.organizationId, orgId)));
    if (!current) throw colNotFound();
    const projectId = current.projectId;
    await lockProject(tx, orgId, projectId);

    const siblings = await projectColumns(tx, projectId);
    if (!siblings.some((c) => c.id === columnId)) throw colNotFound(); // deleted meanwhile
    if (siblings.length <= 1) {
      throw new AppError(409, 'conflict', 'A project needs at least one column');
    }
    if (moveTo === columnId) {
      throw new AppError(422, 'validation', 'moveTo: cannot be the column being deleted');
    }
    const target = moveTo ? siblings.find((c) => c.id === moveTo) : undefined;
    if (moveTo && !target) throw colNotFound();

    const toMove = (await tx.select().from(cards).where(eq(cards.columnId, columnId))).sort(
      comparePositions,
    );
    const movedCardIds: string[] = [];
    if (toMove.length > 0) {
      if (!target) {
        throw new AppError(409, 'conflict', 'The column has cards: choose where to move them');
      }
      const inTarget = (await tx.select().from(cards).where(eq(cards.columnId, target.id))).sort(
        comparePositions,
      );
      let prev: string | null = inTarget[inTarget.length - 1]?.position ?? null;
      for (const card of toMove) {
        prev = positionBetween(prev, null);
        await tx
          .update(cards)
          .set({ columnId: target.id, position: prev })
          .where(eq(cards.id, card.id));
        movedCardIds.push(card.id);
      }
    }
    await tx.delete(columns).where(eq(columns.id, columnId));
    afterCommit(() =>
      bus.toBoard(orgId, projectId, {
        type: 'column.deleted',
        columnId,
        ...(target ? { movedTo: target.id } : {}),
        movedCardIds,
        meta,
      }),
    );
  });
}
