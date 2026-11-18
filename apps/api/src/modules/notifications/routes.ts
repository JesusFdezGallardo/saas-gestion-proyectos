import { UpdateSettingsInput } from '@kanban/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../../http/auth-guard';
import { AppError } from '../../http/errors';
import {
  getSettings,
  listNotifications,
  markAllRead,
  markRead,
  parseCursor,
  unreadCount,
  updateSettings,
} from './service';

export function notificationRoutes(app: FastifyInstance): void {
  const auth = { preHandler: requireUser };

  app.get('/api/notifications', auth, (req) => {
    const { before } = z.object({ before: z.string().max(100).optional() }).parse(req.query);
    return listNotifications(req.user.id, parseCursor(before));
  });

  app.get('/api/notifications/unread-count', auth, async (req) => ({
    count: await unreadCount(req.user.id),
  }));

  app.post('/api/notifications/read-all', auth, async (req, reply) => {
    await markAllRead(req.user.id);
    return reply.status(204).send();
  });

  app.post('/api/notifications/:id/read', auth, (req) => {
    const p = z.object({ id: z.uuid() }).safeParse(req.params);
    if (!p.success) throw new AppError(404, 'not_found', 'Notification not found');
    return markRead(req.user.id, p.data.id);
  });

  app.get('/api/me/settings', auth, (req) => getSettings(req.user.id));

  app.patch('/api/me/settings', auth, (req) =>
    updateSettings(req.user.id, UpdateSettingsInput.parse(req.body)),
  );
}
