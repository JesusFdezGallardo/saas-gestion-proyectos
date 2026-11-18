import { describe, expect, it } from 'vitest';
import { parseMentionIds, toSegments } from '../src/index';

const u1 = '11111111-1111-1111-1111-111111111111';
const u2 = '22222222-2222-2222-2222-222222222222';

describe('mentions', () => {
  it('parseMentionIds returns unique ids in order', () => {
    expect(
      parseMentionIds(`hola @[Ana](user:${u1}) y @[Luis](user:${u2}) @[Ana](user:${u1})`),
    ).toEqual([u1, u2]);
  });
  it('toSegments keeps html as plain text', () => {
    expect(toSegments('<b>x</b>')).toEqual([{ type: 'text', text: '<b>x</b>' }]);
  });
  it('toSegments splits text and mentions', () => {
    expect(toSegments(`a @[Ana](user:${u1}) b`)).toEqual([
      { type: 'text', text: 'a ' },
      { type: 'mention', userId: u1, name: 'Ana' },
      { type: 'text', text: ' b' },
    ]);
  });
  it('ignores malformed tokens', () => {
    expect(parseMentionIds('@[Ana](user:nope)')).toEqual([]);
  });

  it('malformed ids are plain text, not mentions', () => {
    const bad = '@[x](user:------------------------------------)';
    expect(parseMentionIds(bad)).toEqual([]);
    expect(toSegments(bad)).toEqual([{ type: 'text', text: bad }]);
  });
});
