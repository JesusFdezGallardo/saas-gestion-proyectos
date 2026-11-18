import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { MentionInput } from '../src/features/comments/MentionInput';

const LUIS = '11111111-1111-4111-8111-111111111111';
const ALVARO = '22222222-2222-4222-8222-222222222222';
const members = [
  { userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Ana' },
  { userId: LUIS, name: 'Luis' },
  { userId: ALVARO, name: 'Álvaro' },
];

function Harness({ onValue }: { onValue?: (v: string) => void }) {
  const [value, setValue] = useState('');
  return (
    <MentionInput
      label="Comentario"
      members={members}
      value={value}
      onChange={(v) => {
        setValue(v);
        onValue?.(v);
      }}
    />
  );
}

describe('MentionInput', () => {
  it('typing "@lu" shows Luis and Enter inserts the token', async () => {
    const user = userEvent.setup();
    let last = '';
    render(<Harness onValue={(v) => (last = v)} />);
    const box = screen.getByLabelText('Comentario');
    await user.type(box, 'Hola @lu');
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent('Luis');
    await user.keyboard('{Enter}');
    expect(last).toBe(`Hola @[Luis](user:${LUIS}) `);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('filters ignoring accents and case, and supports arrows and click', async () => {
    const user = userEvent.setup();
    let last = '';
    render(<Harness onValue={(v) => (last = v)} />);
    await user.type(screen.getByLabelText('Comentario'), '@AL');
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Álvaro']);
    await user.clear(screen.getByLabelText('Comentario'));
    await user.type(screen.getByLabelText('Comentario'), '@');
    expect(screen.getAllByRole('option')).toHaveLength(3);
    await user.keyboard('{ArrowDown}');
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true');
    await user.click(screen.getAllByRole('option')[2]!);
    expect(last).toBe(`@[Álvaro](user:${ALVARO}) `);
  });

  it('Escape closes the list without inserting anything', async () => {
    const user = userEvent.setup();
    let last = '';
    render(<Harness onValue={(v) => (last = v)} />);
    await user.type(screen.getByLabelText('Comentario'), '@lu');
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(last).toBe('@lu');
  });
});
