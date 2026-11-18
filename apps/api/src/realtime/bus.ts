import type { BoardEvent, UserEvent } from '@kanban/shared';

/**
 * Contract between the REST modules and the realtime layer (Socket.IO, attached in Task 7).
 */
export interface RealtimeBus {
  /** Room `org:<orgId>:board:<projectId>`. */
  toBoard(orgId: string, projectId: string, event: BoardEvent): void;
  /** Room `user:<userId>`. */
  toUser(userId: string, event: UserEvent): void;
  /** Makes every socket of the user leave the `org:<orgId>:*` rooms. */
  removeUserFromOrg(userId: string, orgId: string): Promise<void>;
  broadcast(event: 'demo:reset'): void;
}

/** Bus that goes nowhere: used until Socket.IO is attached to the HTTP server. */
export class NoopBus implements RealtimeBus {
  toBoard(): void {}
  toUser(): void {}
  removeUserFromOrg(): Promise<void> {
    return Promise.resolve();
  }
  broadcast(): void {}
}
