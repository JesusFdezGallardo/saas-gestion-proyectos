import { describe, expect, it } from 'vitest';
import { positionBetween } from '../src/index';

describe('positionBetween', () => {
  it('orders keys', () => {
    const a = positionBetween(null, null),
      b = positionBetween(a, null),
      m = positionBetween(a, b);
    expect(a < m && m < b).toBe(true);
  });
});
