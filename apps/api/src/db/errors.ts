import { DrizzleQueryError } from 'drizzle-orm';

/**
 * Drizzle wraps driver errors in DrizzleQueryError ("Failed query: <sql> params: ..."). Use the
 * original `pg` error instead: callers can map its SQLSTATE `code` (23505, 42501...) and logs
 * do not carry query parameters. Shared by the transaction helpers, the system (owner) paths
 * and the HTTP error handler.
 */
export function unwrapQueryError(err: unknown): unknown {
  return err instanceof DrizzleQueryError && err.cause instanceof Error ? err.cause : err;
}

/** SQLSTATE of a (possibly Drizzle-wrapped) pg error, if any. */
export function pgErrorCode(err: unknown): string | undefined {
  const inner = unwrapQueryError(err);
  const code = (inner as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : undefined;
}

/** Runs a system (owner-pool) operation, rethrowing the original pg error. */
export async function systemOp<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    throw unwrapQueryError(err);
  }
}
