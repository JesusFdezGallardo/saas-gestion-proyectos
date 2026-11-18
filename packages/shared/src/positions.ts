import { generateKeyBetween } from 'fractional-indexing';

/** Returns a sort key strictly between `before` and `after` (null = open end). */
export function positionBetween(before: string | null, after: string | null): string {
  return generateKeyBetween(before, after);
}

/**
 * Orders items by `position` (code-unit comparison, ties broken by id). Fractional-indexing keys
 * only sort correctly bytewise, so never rely on SQL ORDER BY position (locale collation).
 */
export function comparePositions(
  a: { position: string; id: string },
  b: { position: string; id: string },
): number {
  if (a.position !== b.position) return a.position < b.position ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
