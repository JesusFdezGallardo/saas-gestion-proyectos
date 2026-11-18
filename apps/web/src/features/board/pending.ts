/** `clientMutationId`s sent by this tab whose realtime echo must not be applied again. */
const pending = new Set<string>();

/** New id for a write; its echo (if any) will be skipped. Forgotten after a minute. */
export function trackMutation(): string {
  const id = crypto.randomUUID();
  pending.add(id);
  setTimeout(() => pending.delete(id), 60_000);
  return id;
}

/** The write failed: no echo will come. */
export function forgetMutation(id: string): void {
  pending.delete(id);
}

/** True (and forgets it) if the event is the echo of a write made by this tab. */
export function isOwnEcho(clientMutationId: string | undefined): boolean {
  return clientMutationId !== undefined && pending.delete(clientMutationId);
}
