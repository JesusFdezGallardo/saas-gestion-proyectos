import { generateKeyBetween } from 'fractional-indexing';

/** Returns a sort key strictly between `before` and `after` (null = open end). */
export function positionBetween(before: string | null, after: string | null): string {
  return generateKeyBetween(before, after);
}
