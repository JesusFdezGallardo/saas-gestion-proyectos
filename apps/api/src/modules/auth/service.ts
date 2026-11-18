import { createHash, randomBytes } from 'node:crypto';
import type { LoginInput, MeDto, RegisterInput } from '@kanban/shared';
import argon2 from 'argon2';
import { and, asc, eq, gt } from 'drizzle-orm';
import { systemDb } from '../../db/client';
import { pgErrorCode, systemOp } from '../../db/errors';
import { memberships, organizations, sessions, userSettings, users } from '../../db/schema';
import { withUserTx } from '../../db/tx';
import { AppError } from '../../http/errors';

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  isDemo: boolean;
}

export const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;
/** Expiry is pushed forward only when more than a day of it has been used (one write/day). */
const SLIDE_AFTER_MS = 24 * 3600 * 1000;

const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

const hashPassword = (password: string): Promise<string> =>
  argon2.hash(password, { type: argon2.argon2id });

// Verified when the email is unknown so both failures cost about the same time.
const dummyHash = hashPassword('not-a-real-password');

/** Creates a session row; returns the random token that goes into the cookie. */
export async function createSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await systemOp(() =>
    systemDb.insert(sessions).values({
      id: hashToken(token),
      userId,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    }),
  );
  return token;
}

/**
 * Resolves a session token to its user, or null (unknown, expired). Using a session slides its
 * expiry to 30 days from now.
 */
export async function getSessionUser(token: string): Promise<SessionUser | null> {
  const id = hashToken(token);
  const now = new Date();
  const [row] = await systemOp(() =>
    systemDb
      .select({
        expiresAt: sessions.expiresAt,
        id: users.id,
        email: users.email,
        name: users.name,
        isDemo: users.isDemo,
      })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(and(eq(sessions.id, id), gt(sessions.expiresAt, now))),
  );
  if (!row) return null;
  if (row.expiresAt.getTime() - now.getTime() < SESSION_TTL_MS - SLIDE_AFTER_MS) {
    await systemOp(() =>
      systemDb
        .update(sessions)
        .set({ expiresAt: new Date(now.getTime() + SESSION_TTL_MS) })
        .where(eq(sessions.id, id)),
    );
  }
  return { id: row.id, email: row.email, name: row.name, isDemo: row.isDemo };
}

export async function deleteSession(token: string): Promise<void> {
  await systemOp(() => systemDb.delete(sessions).where(eq(sessions.id, hashToken(token))));
}

/** The user plus their memberships. Runs as `app_user`, so RLS decides what is visible. */
export async function getMe(user: SessionUser): Promise<MeDto> {
  const rows = await withUserTx(user.id, ({ tx }) =>
    tx
      .select({
        orgId: memberships.organizationId,
        orgName: organizations.name,
        role: memberships.role,
      })
      .from(memberships)
      .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
      .where(eq(memberships.userId, user.id))
      .orderBy(asc(memberships.createdAt), asc(organizations.name)),
  );
  return { user, memberships: rows };
}

/** Creates user, organization, admin membership and settings, then opens a session. */
export async function register(input: RegisterInput): Promise<{ token: string; me: MeDto }> {
  const passwordHash = await hashPassword(input.password);
  let user: SessionUser;
  try {
    user = await systemOp(() =>
      systemDb.transaction(async (tx) => {
        const [u] = await tx
          .insert(users)
          .values({ email: input.email, name: input.name, passwordHash })
          .returning({ id: users.id, email: users.email, name: users.name, isDemo: users.isDemo });
        if (!u) throw new Error('user insert returned no row');
        const [org] = await tx
          .insert(organizations)
          .values({ name: input.orgName })
          .returning({ id: organizations.id });
        if (!org) throw new Error('organization insert returned no row');
        await tx
          .insert(memberships)
          .values({ organizationId: org.id, userId: u.id, role: 'admin' });
        await tx.insert(userSettings).values({ userId: u.id });
        return u;
      }),
    );
  } catch (err) {
    if (pgErrorCode(err) === '23505') {
      throw new AppError(409, 'conflict', 'That email is already registered');
    }
    throw err;
  }
  const token = await createSession(user.id);
  return { token, me: await getMe(user) };
}

export async function login(input: LoginInput): Promise<{ token: string; me: MeDto }> {
  const [row] = await systemOp(() =>
    systemDb
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        isDemo: users.isDemo,
        passwordHash: users.passwordHash,
      })
      .from(users)
      .where(eq(users.email, input.email)),
  );
  const hash = row?.passwordHash ?? (await dummyHash);
  const valid = await argon2.verify(hash, input.password).catch(() => false);
  if (!row || !row.passwordHash || !valid) {
    throw new AppError(401, 'unauthenticated', 'Invalid email or password');
  }
  const user: SessionUser = { id: row.id, email: row.email, name: row.name, isDemo: row.isDemo };
  const token = await createSession(user.id);
  return { token, me: await getMe(user) };
}
