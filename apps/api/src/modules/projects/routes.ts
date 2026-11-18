import { CreateColumnInput, CreateProjectInput, UpdateProjectInput } from '@kanban/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../http/errors';
import { eventMeta } from '../../http/event-meta';
import { forbidDemo, requireOrg } from '../../http/org-guard';
import { createColumn } from '../columns/service';
import { createProject, deleteProject, getBoard, listProjects, renameProject } from './service';

/** `:projectId`; a malformed id cannot match anything, so 404. */
const projectIdOf = (params: unknown): string => {
  const p = z.object({ projectId: z.uuid() }).safeParse(params);
  if (!p.success) throw new AppError(404, 'not_found', 'Project not found');
  return p.data.projectId;
};

export function projectRoutes(app: FastifyInstance): void {
  const member = { preHandler: requireOrg('member') };

  app.get('/api/orgs/:orgId/projects', member, (req) => listProjects(req.user.id, req.org.id));

  app.post('/api/orgs/:orgId/projects', member, async (req, reply) => {
    const { name } = CreateProjectInput.parse(req.body);
    return reply.status(201).send(await createProject(req.user.id, req.org.id, name));
  });

  app.patch('/api/orgs/:orgId/projects/:projectId', member, (req) => {
    const projectId = projectIdOf(req.params);
    const { name } = UpdateProjectInput.parse(req.body);
    return renameProject(app.bus, eventMeta(req), req.org.id, projectId, name);
  });

  app.delete(
    '/api/orgs/:orgId/projects/:projectId',
    { preHandler: [...requireOrg('admin'), forbidDemo] },
    async (req, reply) => {
      await deleteProject(app.bus, eventMeta(req), req.org.id, projectIdOf(req.params));
      return reply.status(204).send();
    },
  );

  app.get('/api/orgs/:orgId/projects/:projectId/board', member, (req) =>
    getBoard(req.user.id, req.org.id, projectIdOf(req.params)),
  );

  app.post('/api/orgs/:orgId/projects/:projectId/columns', member, async (req, reply) => {
    const projectId = projectIdOf(req.params);
    const { name } = CreateColumnInput.parse(req.body);
    const column = await createColumn(app.bus, eventMeta(req), req.org.id, projectId, name);
    return reply.status(201).send(column);
  });
}
