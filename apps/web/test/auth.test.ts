import { describe, expect, it } from 'vitest';
import { safeReturnPath } from '../src/lib/auth';

describe('safeReturnPath', () => {
  it('keeps same-site paths', () => {
    expect(safeReturnPath('/o/x')).toBe('/o/x');
    expect(safeReturnPath('/invitacion/abc?x=1#h')).toBe('/invitacion/abc?x=1#h');
  });

  it.each([
    null,
    '',
    'o/x',
    '//evil.com',
    '/.//evil.com',
    '/./..//evil.com',
    '/\\evil.com',
    '/\t/evil.com',
    '/\n/evil.com',
    '\\\\evil.com',
    'https://evil.com',
    'javascript:alert(1)',
  ])('rejects %j', (value) => {
    expect(safeReturnPath(value)).toBeNull();
  });
});
