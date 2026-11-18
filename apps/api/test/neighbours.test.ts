import { describe, expect, it } from 'vitest';
import { resolveNeighbourPosition } from '../src/db/neighbours';

const sibs = [
  { id: 'a', position: 'a0' },
  { id: 'b', position: 'a1' },
  { id: 'c', position: 'a2' },
];
const positions = sibs.map((s) => s.position);

describe('resolveNeighbourPosition', () => {
  it('places between two adjacent valid neighbours', () => {
    const p = resolveNeighbourPosition(sibs, 'a', 'b');
    expect(p > 'a0' && p < 'a1').toBe(true);
  });

  it('with only beforeId, goes right after it', () => {
    const p = resolveNeighbourPosition(sibs, 'b', null);
    expect(p > 'a1' && p < 'a2').toBe(true);
  });

  it('with only afterId, goes right before it', () => {
    const p = resolveNeighbourPosition(sibs, undefined, 'b');
    expect(p > 'a0' && p < 'a1').toBe(true);
  });

  it('stale or foreign ids are ignored: end of the list', () => {
    expect(resolveNeighbourPosition(sibs, 'ghost', 'phantom') > 'a2').toBe(true);
    expect(resolveNeighbourPosition(sibs, 'ghost', null) > 'a2').toBe(true);
    expect(resolveNeighbourPosition(sibs, null, 'ghost') > 'a2').toBe(true);
    expect(resolveNeighbourPosition(sibs, null, null) > 'a2').toBe(true);
  });

  it('one stale and one valid neighbour uses the valid one', () => {
    const p = resolveNeighbourPosition(sibs, 'ghost', 'c');
    expect(p > 'a1' && p < 'a2').toBe(true);
  });

  it('non-adjacent pair: beforeId wins and the result is never an existing position', () => {
    const p = resolveNeighbourPosition(sibs, 'a', 'c');
    expect(p > 'a0' && p < 'a1').toBe(true);
    expect(positions).not.toContain(p);
  });

  it('reversed pair falls back to a position that is not an existing one', () => {
    const p = resolveNeighbourPosition(sibs, 'c', 'a');
    expect(positions).not.toContain(p);
  });

  it('empty siblings: still returns a key', () => {
    expect(typeof resolveNeighbourPosition([], null, null)).toBe('string');
    expect(typeof resolveNeighbourPosition([], 'x', 'y')).toBe('string');
  });
});
