export const MENTION_RE = /@\[([^\]\n]{1,80})\]\(user:([0-9a-f-]{36})\)/g;

export type Segment =
  { type: 'text'; text: string } | { type: 'mention'; userId: string; name: string };

/** Unique mentioned user ids, in order of first appearance. */
export function parseMentionIds(body: string): string[] {
  const ids: string[] = [];
  for (const m of body.matchAll(new RegExp(MENTION_RE.source, 'g'))) {
    const id = m[2]!;
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

/** Splits a comment body into plain-text and mention segments (never interprets HTML). */
export function toSegments(body: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const m of body.matchAll(new RegExp(MENTION_RE.source, 'g'))) {
    if (m.index > last) out.push({ type: 'text', text: body.slice(last, m.index) });
    out.push({ type: 'mention', userId: m[2]!, name: m[1]! });
    last = m.index + m[0].length;
  }
  if (last < body.length) out.push({ type: 'text', text: body.slice(last) });
  return out;
}
