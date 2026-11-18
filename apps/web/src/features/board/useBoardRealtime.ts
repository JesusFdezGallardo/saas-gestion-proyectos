import type { BoardDto, BoardEventEnvelope, ProjectDto } from '@kanban/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getSocket } from '../../lib/socket';
import { toast } from '../../lib/toast';
import { applyCommentEvent } from '../comments/useComments';
import { projectsKey } from '../orgs/ProjectsPage';
import { applyEvent } from './applyEvent';
import { isOwnEcho } from './pending';
import { boardKey } from './useBoard';

/**
 * Keeps the cached board in sync: joins the board room on mount, leaves on unmount, applies
 * incoming events and refetches whenever the socket (re)connects, since events may have been missed.
 */
export function useBoardRealtime(orgId: string, projectId: string): void {
  const qc = useQueryClient();
  const navigate = useNavigate();

  useEffect(() => {
    const socket = getSocket();
    const ref = { orgId, projectId };
    const key = boardKey(projectId);
    let active = true;

    const join = () => {
      const startedAt = Date.now();
      socket.emit('board:join', ref, (ack) => {
        if (!active || !ack.ok) return;
        // A board fetched before we were in the room may have missed events: fetch it again.
        void qc.invalidateQueries({ queryKey: ['comments'] });
        const state = qc.getQueryState(key);
        if (state && (state.fetchStatus === 'fetching' || state.dataUpdatedAt < startedAt)) {
          void qc.invalidateQueries({ queryKey: key });
        }
      });
    };

    const onEvent = ({ orgId: o, projectId: p, event }: BoardEventEnvelope) => {
      if (o !== orgId || p !== projectId) return;
      if (isOwnEcho(event.meta.clientMutationId)) return;
      if (event.type === 'project.deleted') {
        if (event.projectId !== projectId) return;
        qc.setQueryData<ProjectDto[]>(projectsKey(orgId), (list) =>
          list?.filter((x) => x.id !== projectId),
        );
        navigate(`/o/${orgId}`, { replace: true });
        qc.removeQueries({ queryKey: key });
        toast('El proyecto se ha borrado');
        return;
      }
      if (event.type === 'project.updated') {
        qc.setQueryData<ProjectDto[]>(projectsKey(orgId), (list) =>
          list?.map((x) => (x.id === event.project.id ? event.project : x)),
        );
      }
      if (event.type.startsWith('comment.')) {
        // The open card's thread; the board cache only needs the comment count (card.updated).
        applyCommentEvent(qc, event as Parameters<typeof applyCommentEvent>[1]);
      }
      qc.setQueryData<BoardDto>(key, (board) => (board ? applyEvent(board, event) : board));
    };

    socket.on('connect', join);
    socket.on('board:event', onEvent);
    // While disconnected, `connect` will join; emitting now would join twice.
    if (socket.connected) join();

    return () => {
      active = false;
      socket.off('connect', join);
      socket.off('board:event', onEvent);
      if (socket.connected) socket.emit('board:leave', ref);
    };
  }, [orgId, projectId, qc, navigate]);
}
