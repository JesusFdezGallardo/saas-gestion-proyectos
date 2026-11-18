import type { CreateLabelInput, EventMeta, LabelDto, UpdateLabelInput } from '@kanban/shared';
import { and, eq } from 'drizzle-orm';
import { labels } from '../../db/schema';
import { withOrgTx, type Tx } from '../../db/tx';
import { AppError } from '../../http/errors';
import type { RealtimeBus } from '../../realtime/bus';
import { lockProject } from '../columns/service';

const notFound = () => new AppError(404, 'not_found', 'Label not found');

export const toLabelDto = (r: typeof labels.$inferSelect): LabelDto => ({
  id: r.id,
  projectId: r.projectId,
  name: r.name,
  color: r.color,
});

/** Finds a label, locks its project (same lock as card writes) and re-reads it under the lock. */
async function lockedLabel(tx: Tx, orgId: string, labelId: string) {
  const [first] = await tx
    .select({ projectId: labels.projectId })
    .from(labels)
    .where(and(eq(labels.id, labelId), eq(labels.organizationId, orgId)));
  if (!first) throw notFound();
  await lockProject(tx, orgId, first.projectId);
  const [current] = await tx
    .select()
    .from(labels)
    .where(and(eq(labels.id, labelId), eq(labels.organizationId, orgId)));
  if (!current) throw notFound();
  return current;
}

export function createLabel(
  bus: RealtimeBus,
  meta: EventMeta,
  orgId: string,
  projectId: string,
  input: CreateLabelInput,
): Promise<LabelDto> {
  return withOrgTx(meta.actorId, orgId, async ({ tx, afterCommit }) => {
    await lockProject(tx, orgId, projectId);
    const [row] = await tx
      .insert(labels)
      .values({ organizationId: orgId, projectId, name: input.name, color: input.color })
      .returning();
    if (!row) throw new Error('label insert returned no row');
    const label = toLabelDto(row);
    afterCommit(() => bus.toBoard(orgId, projectId, { type: 'label.created', label, meta }));
    return label;
  });
}

export function updateLabel(
  bus: RealtimeBus,
  meta: EventMeta,
  orgId: string,
  labelId: string,
  input: UpdateLabelInput,
): Promise<LabelDto> {
  return withOrgTx(meta.actorId, orgId, async ({ tx, afterCommit }) => {
    const current = await lockedLabel(tx, orgId, labelId);
    const patch: { name?: string; color?: string } = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.color !== undefined) patch.color = input.color;
    let row = current;
    if (Object.keys(patch).length > 0) {
      const [updated] = await tx
        .update(labels)
        .set(patch)
        .where(eq(labels.id, labelId))
        .returning();
      if (!updated) throw notFound();
      row = updated;
    }
    const label = toLabelDto(row);
    afterCommit(() => bus.toBoard(orgId, row.projectId, { type: 'label.updated', label, meta }));
    return label;
  });
}

export function deleteLabel(
  bus: RealtimeBus,
  meta: EventMeta,
  orgId: string,
  labelId: string,
): Promise<void> {
  return withOrgTx(meta.actorId, orgId, async ({ tx, afterCommit }) => {
    const current = await lockedLabel(tx, orgId, labelId);
    await tx.delete(labels).where(eq(labels.id, labelId)); // card_labels rows cascade
    afterCommit(() =>
      bus.toBoard(orgId, current.projectId, { type: 'label.deleted', labelId, meta }),
    );
  });
}
