import {
  COLLAB_ACCESS_MODE,
  type CollabRole,
} from "@softmaple/collab-protocol";
import type {
  CommittedDocumentEvent,
  ConnectionLimiter,
  DocumentAccess,
  DocumentSessionAuthorizationRequest,
  DocumentSessionHooks,
  DocumentSessionRefreshRequest,
  RoomFanout,
  RoomFanoutHandler,
  RoomFanoutSubscription,
} from "@softmaple/collab-runtime";

type PendingDelivery = {
  readonly event: CommittedDocumentEvent;
  readonly handler: RoomFanoutHandler;
};

/**
 * Shared semantic fan-out with deterministic delivery controls for the
 * consistency/convergence harness.
 */
export class ControllableRoomFanout implements RoomFanout {
  private readonly handlers = new Map<string, Set<RoomFanoutHandler>>();
  private readonly pending: PendingDelivery[] = [];
  private closed = false;
  deliveryMode: "immediate" | "deferred" = "immediate";

  async publish(event: CommittedDocumentEvent): Promise<void> {
    if (this.closed) throw new Error("Room fan-out is closed");
    const handlers = [...(this.handlers.get(event.documentId) ?? [])];
    if (this.deliveryMode === "immediate") {
      await Promise.all(handlers.map((handler) => handler(event)));
      return;
    }
    for (const handler of handlers) {
      this.pending.push({ event, handler });
    }
  }

  async subscribe(
    documentId: string,
    handler: RoomFanoutHandler,
  ): Promise<RoomFanoutSubscription> {
    if (this.closed) throw new Error("Room fan-out is closed");
    const existing =
      this.handlers.get(documentId) ?? new Set<RoomFanoutHandler>();
    existing.add(handler);
    this.handlers.set(documentId, existing);
    let subscribed = true;
    return {
      unsubscribe: async () => {
        if (!subscribed) return;
        subscribed = false;
        const current = this.handlers.get(documentId);
        current?.delete(handler);
        if (current?.size === 0) this.handlers.delete(documentId);
      },
    };
  }

  async close(): Promise<void> {
    this.closed = true;
    this.handlers.clear();
    this.pending.length = 0;
  }

  pendingCount(): number {
    return this.pending.length;
  }

  async deliverNext(): Promise<boolean> {
    const next = this.pending.shift();
    if (next === undefined) return false;
    await next.handler(next.event);
    return true;
  }

  async deliverAll(): Promise<number> {
    let count = 0;
    while (await this.deliverNext()) {
      count += 1;
    }
    return count;
  }

  /** Re-queue the front delivery so the same committed event is applied twice. */
  duplicateNext(): boolean {
    const next = this.pending[0];
    if (next === undefined) return false;
    this.pending.splice(1, 0, { ...next });
    return true;
  }

  /** Move the front delivery behind the next one when both exist. */
  reorderNextPair(): boolean {
    const first = this.pending[0];
    const second = this.pending[1];
    if (first === undefined || second === undefined) return false;
    this.pending.splice(0, 2, second, first);
    return true;
  }
}

/** Connection admission fake that never applies a capacity ceiling. */
export const createUnlimitedConnectionLimiter = (): ConnectionLimiter => ({
  async acquire() {
    let released = false;
    return {
      accepted: true,
      lease: {
        async refresh() {
          return !released;
        },
        async release() {
          released = true;
        },
      },
    };
  },
});

/** Deterministic identity adapter keyed by the physical fake peer id. */
export class FakeDocumentSessionHooks implements DocumentSessionHooks {
  private readonly accessByPeerId = new Map<string, DocumentAccess>();

  registerAuthenticatedPeer(
    peerId: string,
    actorId: string,
    options?: {
      readonly canWrite?: boolean;
      readonly role?: CollabRole;
    },
  ): void {
    this.accessByPeerId.set(peerId, {
      accessMode: COLLAB_ACCESS_MODE.Authenticated,
      actorId,
      canWrite: options?.canWrite ?? true,
      role: options?.role ?? "EDITOR",
    });
  }

  forgetPeer(peerId: string): void {
    this.accessByPeerId.delete(peerId);
  }

  async authorize(
    request: DocumentSessionAuthorizationRequest,
  ): Promise<DocumentAccess | null> {
    return this.accessByPeerId.get(request.peerId) ?? null;
  }

  async refresh(
    request: DocumentSessionRefreshRequest,
  ): Promise<DocumentAccess | null> {
    return this.accessByPeerId.get(request.peerId) ?? null;
  }
}
