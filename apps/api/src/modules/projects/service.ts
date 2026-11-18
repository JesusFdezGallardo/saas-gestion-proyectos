import {
  comparePositions,
  positionBetween,
  type BoardDto,
  type CardDto,
  type ColumnDto,
  type EventMeta,
  type LabelDto,
  type ProjectDto,
} from '@kanban/shared';
import { and, asc, eq } from 'drizzle-orm';
import { cardLabels, cards, columns, labels, memberships, projects, users } from '../../db/schema';
import { withOrgTx } from '../../db/tx';
import { AppError } from '../../http/errors';
import type { RealtimeBus } from '../../realtime/bus';

export const DEFAULT_COLUMNS = ['Por hacer', 'En curso', 'Hecho'] as const;

export const toProjectDto = (r: typeof projects.$inferSelect): ProjectDto => ({
  id: r.id,
  name: r.name,
  createdAt: r.createdAt.toISOString(),
});

export const toColumnDto = (r: typeof columns.$inferSelect): ColumnDto => ({
  id: r.id,
  projectId: r.projectId,
  name: r.name,
  position: r.position,
});

const notFound = () => new AppError(404, 'not_found', 'Project not found');

export function listProjects(userId: string, orgId: string): Promise<ProjectDto[]> {
  return withOrgTx(userId, orgId, async ({ tx }) => {
    const rows = await tx
      .select()
      .from(projects)
      .where(eq(projects.organizationId, orgId))
      .orderBy(asc(projects.createdAt), asc(projects.id));
    return rows.map(toProjectDto);
  });
}

export function createProject(userId: string, orgId: string, name: string): Promise<ProjectDto> {
  return withOrgTx(userId, orgId, async ({ tx }) => {
    const [project] = await tx.insert(projects).values({ organizationId: orgId, name }).returning();
    if (!project) throw new Error('project insert returned no row');
    let prev: string | null = null;
    const values = DEFAULT_COLUMNS.map((colName) => {
      prev = positionBetween(prev, null);
      return { organizationId: orgId, projectId: project.id, name: colName, position: prev };
    });
    await tx.insert(columns).values(values);
    return toProjectDto(project);
  });
}

export function renameProject(
  bus: RealtimeBus,
  meta: EventMeta,
  orgId: string,
  projectId: string,
  name: string,
): Promise<ProjectDto> {
  return withOrgTx(meta.actorId, orgId, async ({ tx, afterCommit }) => {
    const [row] = await tx
      .update(projects)
      .set({ name })
      .where(and(eq(projects.id, projectId), eq(projects.organizationId, orgId)))
      .returning();
    if (!row) throw notFound();
    const project = toProjectDto(row);
    afterCommit(() => bus.toBoard(orgId, projectId, { type: 'project.updated', project, meta }));
    return project;
  });
}

export function deleteProject(
  bus: RealtimeBus,
  meta: EventMeta,
  orgId: string,
  projectId: string,
): Promise<void> {
  return withOrgTx(meta.actorId, orgId, async ({ tx, afterCommit }) => {
    const deleted = await tx
      .delete(projects)
      .where(and(eq(projects.id, projectId), eq(projects.organizationId, orgId)))
      .returning({ id: projects.id });
    if (deleted.length === 0) throw notFound();
    afterCommit(() => bus.toBoard(orgId, projectId, { type: 'project.deleted', projectId, meta }));
  });
}

export function getBoard(userId: string, orgId: string, projectId: string): Promise<BoardDto> {
  return withOrgTx(userId, orgId, async ({ tx }) => {
    const [project] = await tx
      .select()
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.organizationId, orgId)));
    if (!project) throw notFound();
    const colRows = await tx.select().from(columns).where(eq(columns.projectId, projectId));
    const cardRows = await tx.select().from(cards).where(eq(cards.projectId, projectId));
    const cardLabelRows = await tx
      .select({ cardId: cardLabels.cardId, labelId: cardLabels.labelId })
      .from(cardLabels)
      .innerJoin(cards, eq(cards.id, cardLabels.cardId))
      .where(eq(cards.projectId, projectId));
    const labelIdsByCard = new Map<string, string[]>();
    for (const r of cardLabelRows) {
      const list = labelIdsByCard.get(r.cardId) ?? [];
      list.push(r.labelId);
      labelIdsByCard.set(r.cardId, list);
    }
    const labelRows = await tx.select().from(labels).where(eq(labels.projectId, projectId));
    const memberRows = await tx
      .select({ userId: users.id, name: users.name })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.organizationId, orgId))
      .orderBy(asc(memberships.createdAt), asc(users.name));
    const cardDtos: CardDto[] = cardRows.sort(comparePositions).map((c) => ({
      id: c.id,
      projectId: c.projectId,
      columnId: c.columnId,
      title: c.title,
      description: c.description,
      assigneeId: c.assigneeId,
      dueDate: c.dueDate,
      position: c.position,
      labelIds: (labelIdsByCard.get(c.id) ?? []).sort(),
      createdBy: c.createdBy,
      commentCount: 0,
    }));
    const labelDtos: LabelDto[] = labelRows.map((l) => ({
      id: l.id,
      projectId: l.projectId,
      name: l.name,
      color: l.color,
    }));
    return {
      project: toProjectDto(project),
      columns: colRows.sort(comparePositions).map(toColumnDto),
      cards: cardDtos,
      labels: labelDtos,
      members: memberRows,
    };
  });
}
