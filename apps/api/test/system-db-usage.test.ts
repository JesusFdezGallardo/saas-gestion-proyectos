import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * `systemDb` is the owner-role pool that bypasses Row-Level Security. Only code that is
 * legitimately outside an organization may import it: db/client.ts itself, authentication,
 * invitations (the invitee is not a member yet), the mail pipeline (by email address) and the
 * demo seed/reset. Tests (`apps/api/test`) are outside `src` and may use it freely.
 */
const SRC = join(__dirname, '..', 'src');

const ALLOWED = [
  /^db\/client\.ts$/,
  /^modules\/auth\/[^/]+\.ts$/,
  /^modules\/invitations\/service\.ts$/,
  /^modules\/mail\/[^/]+\.ts$/,
  /^modules\/demo\/[^/]+\.ts$/,
];

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return tsFiles(full);
    return name.endsWith('.ts') ? [full] : [];
  });
}

/** Import declarations (incl. multi-line, `import type`, aliases) whose specifier ends in db/client. */
const IMPORT_FROM_CLIENT =
  /import\s+(?:type\s+)?(?:[\w$]+\s*,\s*)?(?:\{([^}]*)\}|\*\s+as\s+([\w$]+)|[\w$]+)\s+from\s+['"]([^'"]*\bdb\/client(?:\.[jt]s)?|\.\/client(?:\.[jt]s)?)['"]/g;

/** Dynamic `import('.../db/client')` and `require` would bypass the check above. */
const DYNAMIC_CLIENT = /(?:import|require)\s*\(\s*['"][^'"]*db\/client(?:\.[jt]s)?['"]\s*\)/;

function importsSystemDb(source: string): boolean {
  for (const m of source.matchAll(IMPORT_FROM_CLIENT)) {
    const names = m[1];
    // `{ systemDb }`, `{ systemDb as x }`; a namespace import can reach it as well.
    if (m[2] !== undefined) return true;
    if (names !== undefined && /(^|[\s,])systemDb(\s|,|$)/.test(names)) return true;
  }
  return false;
}

describe('systemDb is imported only where it is allowed', () => {
  const files = tsFiles(SRC).map((f) => ({
    rel: relative(SRC, f).split(sep).join('/'),
    source: readFileSync(f, 'utf8'),
  }));

  it('scans the source tree', () => {
    expect(files.length).toBeGreaterThan(30);
    expect(files.some((f) => f.rel === 'db/client.ts')).toBe(true);
  });

  it('the detector recognises the import shapes it must catch', () => {
    expect(importsSystemDb(`import { systemDb } from '../../db/client';`)).toBe(true);
    expect(importsSystemDb(`import { closeDb, systemDb } from '../../db/client';`)).toBe(true);
    expect(importsSystemDb(`import {\n  appDb,\n  systemDb as sys,\n} from '../db/client';`)).toBe(
      true,
    );
    expect(importsSystemDb(`import * as db from '../db/client';`)).toBe(true);
    expect(importsSystemDb(`import { appDb } from '../db/client';`)).toBe(false);
    expect(importsSystemDb(`// import { systemDb } from '../db/client'`)).toBe(true); // conservative
    expect(importsSystemDb(`import { systemDbX } from '../db/client';`)).toBe(false);
  });

  it('only the allowed modules import it', () => {
    const offenders = files
      .filter((f) => importsSystemDb(f.source) || DYNAMIC_CLIENT.test(f.source))
      .map((f) => f.rel)
      .filter((rel) => !ALLOWED.some((re) => re.test(rel)));
    expect(offenders, 'files importing systemDb outside the allowed list').toEqual([]);
  });

  it('the allow list is not stale: every allowed pattern still has a user (except client.ts)', () => {
    const users = files.filter((f) => importsSystemDb(f.source)).map((f) => f.rel);
    for (const re of ALLOWED.slice(1)) {
      expect(
        users.some((u) => re.test(u)),
        String(re),
      ).toBe(true);
    }
  });
});
