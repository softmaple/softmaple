/**
 * Outgoing durable-write queue for collaboration event batches.
 *
 * States per batch: pending → in-flight → durable (removed).
 *
 * Only one causally dependent write is in flight at a time so the server never
 * validates a child batch before its local parents are durable. Independent
 * remote collaborators are unaffected — this queue is per browser session.
 */

export interface OutgoingBatchLike {
  readonly batchId: string;
}

export const createOutgoingBatchQueue = <T extends OutgoingBatchLike>({
  maxBatchesPerSend,
  send,
}: {
  readonly maxBatchesPerSend: number;
  readonly send: (batches: ReadonlyArray<T>) => boolean;
}) => {
  const pending = new Map<string, T>();
  const inFlight = new Set<string>();

  const flush = (): boolean => {
    if (inFlight.size > 0 || pending.size === 0) return false;
    // Map insertion order matches local creation order, so parents precede
    // children for a single replica's linear edits.
    const chunk = [...pending.values()].slice(0, maxBatchesPerSend);
    if (chunk.length === 0) return false;
    if (!send(chunk)) return false;
    for (const batch of chunk) {
      inFlight.add(batch.batchId);
    }
    return true;
  };

  return {
    /** Record batches as pending without opening a durable write. */
    add(batches: ReadonlyArray<T>): void {
      for (const batch of batches) {
        pending.set(batch.batchId, batch);
      }
    },

    /** Add batches and immediately attempt one in-flight durable write. */
    enqueue(batches: ReadonlyArray<T>): boolean {
      for (const batch of batches) {
        pending.set(batch.batchId, batch);
      }
      return flush();
    },

    /** Attempt to send the next pending chunk when nothing is in flight. */
    flush,

    acknowledge(batchIds: ReadonlyArray<string>): boolean {
      for (const batchId of batchIds) {
        pending.delete(batchId);
        inFlight.delete(batchId);
      }
      return flush();
    },

    /**
     * Clear in-flight markers after disconnect. Pending batch identity is
     * preserved so the exact same payloads can be resent idempotently.
     */
    resetInFlight(): void {
      inFlight.clear();
    },

    peekPending(): ReadonlyArray<T> {
      return [...pending.values()];
    },

    pendingSize(): number {
      return pending.size;
    },

    inFlightSize(): number {
      return inFlight.size;
    },

    hasPending(): boolean {
      return pending.size > 0;
    },

    hasInFlight(): boolean {
      return inFlight.size > 0;
    },
  };
};

export type OutgoingBatchQueue<T extends OutgoingBatchLike> = ReturnType<
  typeof createOutgoingBatchQueue<T>
>;
