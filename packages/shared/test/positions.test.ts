import { describe, expect, it } from 'vitest';
import { comparePositions, positionBetween } from '../src/index';

describe('positionBetween', () => {
  it('orders keys', () => {
    const a = positionBetween(null, null),
      b = positionBetween(a, null),
      m = positionBetween(a, b);
    expect(a < m && m < b).toBe(true);
  });
});

it('comparePositions sorts bytewise (uppercase before lowercase) and breaks ties by id', () => {
  expect(comparePositions({ position: 'Zz', id: 'x' }, { position: 'a0', id: 'y' })).toBeLessThan(
    0,
  );
  expect(
    comparePositions({ position: 'a0', id: 'x' }, { position: 'Zz', id: 'y' }),
  ).toBeGreaterThan(0);
  expect(comparePositions({ position: 'a0', id: 'a' }, { position: 'a0', id: 'b' })).toBeLessThan(
    0,
  );
  expect(comparePositions({ position: 'a0', id: 'a' }, { position: 'a0', id: 'a' })).toBe(0);
});
