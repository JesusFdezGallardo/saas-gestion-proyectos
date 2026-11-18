import type { CommentDto } from '@kanban/shared';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CommentList } from '../src/features/comments/CommentList';

const LUIS = '11111111-1111-4111-8111-111111111111';
const members = [
  { userId: 'u1', name: 'Ana' },
  { userId: LUIS, name: 'Luis' },
];
const comment = (over: Partial<CommentDto>): CommentDto => ({
  id: 'c1',
  cardId: 'card',
  authorId: 'u1',
  authorName: 'Ana',
  body: 'hola',
  editedAt: null,
  createdAt: '2026-11-18T10:00:00.000Z',
  ...over,
});

describe('CommentList', () => {
  it('renders <script> as text and mentions as highlighted spans', () => {
    const { container } = render(
      <CommentList
        comments={[
          comment({
            body: `<script>alert(1)</script> <b>x</b>\n@[Luis](user:${LUIS}) mira esto`,
          }),
        ]}
        members={members}
        meId="u1"
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    expect(screen.getByText(/<script>alert\(1\)<\/script> <b>x<\/b>/)).toBeInTheDocument();
    const mention = container.querySelector('[data-mention]');
    expect(mention).toHaveTextContent('@Luis');
    expect(mention?.tagName).toBe('SPAN');
  });

  it('offers edit and delete only on own comments', async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn().mockResolvedValue(undefined);
    render(
      <CommentList
        comments={[
          comment({ id: 'a', authorId: 'u1', body: 'mío' }),
          comment({ id: 'b', authorId: 'u2', authorName: 'Luis', body: 'tuyo' }),
        ]}
        members={members}
        meId="u1"
        onEdit={vi.fn()}
        onDelete={onDelete}
      />,
    );
    const items = screen.getAllByRole('listitem');
    expect(within(items[0]!).getByRole('button', { name: 'Editar' })).toBeInTheDocument();
    expect(within(items[1]!).queryByRole('button', { name: 'Editar' })).not.toBeInTheDocument();
    expect(within(items[1]!).queryByRole('button', { name: 'Borrar' })).not.toBeInTheDocument();
    await user.click(within(items[0]!).getByRole('button', { name: 'Borrar' }));
    await user.click(within(items[0]!).getByRole('button', { name: 'Sí, borrar' }));
    expect(onDelete).toHaveBeenCalledWith('a');
  });
});
