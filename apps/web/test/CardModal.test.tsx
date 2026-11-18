import type { BoardDto } from '@kanban/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { applyEvent } from '../src/features/board/applyEvent';
import { CardModal } from '../src/features/board/CardModal';
import { boardKey } from '../src/features/board/useBoard';
import { Toaster } from '../src/lib/toast';

const board: BoardDto = {
  project: { id: 'p1', name: 'Web', createdAt: '2026-11-18T00:00:00.000Z' },
  columns: [{ id: 'col1', projectId: 'p1', name: 'Por hacer', position: 'a0' }],
  cards: [
    {
      id: 'c1',
      projectId: 'p1',
      columnId: 'col1',
      title: 'Diseñar logo',
      description: '',
      assigneeId: null,
      dueDate: null,
      position: 'a0',
      labelIds: [],
      createdBy: 'u1',
      commentCount: 0,
    },
  ],
  labels: [],
  members: [{ userId: 'u1', name: 'Ana' }],
};

function setup(cardId: string) {
  const qc = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  qc.setQueryData(boardKey('p1'), board);
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={qc}>
      <CardModal orgId="o1" projectId="p1" cardId={cardId} onClose={onClose} />
      <Toaster />
    </QueryClientProvider>,
  );
  return { qc, onClose };
}

describe('CardModal', () => {
  it('CardModal closes and shows "La tarjeta se ha borrado" when its card disappears', async () => {
    const { qc, onClose } = setup('c1');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText('Título')).toHaveValue('Diseñar logo');
    expect(onClose).not.toHaveBeenCalled();

    act(() => {
      qc.setQueryData<BoardDto>(boardKey('p1'), (b) =>
        applyEvent(b!, { type: 'card.deleted', cardId: 'c1', meta: { actorId: 'u2' } }),
      );
    });

    expect(await screen.findByText('La tarjeta se ha borrado')).toBeInTheDocument();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes with a "not found" toast for a card id that is not on the board', async () => {
    const { onClose } = setup('missing');
    expect(await screen.findByText('No se ha encontrado la tarjeta')).toBeInTheDocument();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
