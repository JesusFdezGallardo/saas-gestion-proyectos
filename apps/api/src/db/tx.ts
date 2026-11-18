import { sql } from 'drizzle-orm';
import { appDb } from './client';
import { unwrapQueryError } from './errors';

export type Tx = Parameters<Parameters<typeof appDb.transaction>[0]>[0];

export interface TxCtx {
  tx: Tx;
  /** Queues `fn` to run after a successful COMMIT (never on rollback). Errors are logged. */
  afterCommit(fn: () => void | Promise<void>): void;
}

async function runTx<T>(
  settings: { userId: string; orgId?: string },
  fn: (c: TxCtx) => Promise<T>,
): Promise<T> {
  const callbacks: Array<() => void | Promise<void>> = [];
  let open = true;
  const afterCommit = (cb: () => void | Promise<void>): void => {
    if (!open) throw new Error('afterCommit called after the transaction finished');
    callbacks.push(cb);
  };

  let result: T;
  try {
    result = await appDb.transaction(async (tx) => {
      // set_config(..., true) == SET LOCAL: the values vanish at COMMIT/ROLLBACK.
      await tx.execute(sql`select set_config('app.user_id', ${settings.userId}, true)`);
      if (settings.orgId !== undefined) {
        await tx.execute(sql`select set_config('app.org_id', ${settings.orgId}, true)`);
      }
      return fn({ tx, afterCommit });
    });
  } catch (err) {
    throw unwrapQueryError(err);
  } finally {
    open = false;
  }

  for (const cb of callbacks) {
    try {
      await cb();
    } catch (err) {
      console.error('afterCommit callback failed', err);
    }
  }
  return result;
}

/** Transaction as `app_user` with `app.user_id` set (no organization scope). */
export function withUserTx<T>(userId: string, fn: (c: TxCtx) => Promise<T>): Promise<T> {
  return runTx({ userId }, fn);
}

/** Transaction as `app_user` with `app.user_id` and `app.org_id` set. */
export function withOrgTx<T>(
  userId: string,
  orgId: string,
  fn: (c: TxCtx) => Promise<T>,
): Promise<T> {
  return runTx({ userId, orgId }, fn);
}
