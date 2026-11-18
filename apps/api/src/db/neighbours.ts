import { positionBetween } from '@kanban/shared';

/**
 * Safe sort key for an item placed between the client's `beforeId` (the item that ends up just
 * above it) and `afterId` (just below). `siblings` are the other items of the same list, already
 * sorted (see `comparePositions`) and without the item being placed.
 *
 * Neighbours that are not in `siblings` (stale, foreign, deleted) are ignored. If both are valid
 * but no longer adjacent, `beforeId` wins (placed right after it); with only one valid neighbour
 * the real adjacent sibling is used as the other bound; with none, the item goes to the end.
 * The result is therefore never equal to the position of an existing sibling.
 */
export function resolveNeighbourPosition(
  siblings: ReadonlyArray<{ id: string; position: string }>,
  beforeId: string | null | undefined,
  afterId: string | null | undefined,
): string {
  const idx = (id: string | null | undefined) => (id ? siblings.findIndex((c) => c.id === id) : -1);
  const bi = idx(beforeId);
  let ai = idx(afterId);
  if (bi >= 0 && ai >= 0 && ai !== bi + 1) ai = -1; // stale: no longer adjacent
  const lastPos = siblings[siblings.length - 1]?.position ?? null;

  let lower: string | null;
  let upper: string | null;
  if (bi >= 0) {
    lower = siblings[bi]!.position;
    upper = siblings[bi + 1]?.position ?? null;
  } else if (ai >= 0) {
    lower = siblings[ai - 1]?.position ?? null;
    upper = siblings[ai]!.position;
  } else {
    lower = lastPos;
    upper = null;
  }
  if (lower !== null && upper !== null && lower >= upper) {
    lower = lastPos;
    upper = null;
  }
  return positionBetween(lower, upper);
}
