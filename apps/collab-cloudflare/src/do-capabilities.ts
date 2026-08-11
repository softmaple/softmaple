import {
  CONNECTION_REJECTION_REASON,
  type CommittedDocumentEvent,
  type ConnectionLimiter,
  type RoomFanout,
  type RoomFanoutHandler,
} from "@softmaple/collab-runtime";

export const createDurableObjectConnectionLimiter = (): ConnectionLimiter => {
  const peers = new Set<string>();
  return {
    async acquire(request) {
      if (peers.has(request.peerId)) {
        return {
          accepted: false,
          reason: CONNECTION_REJECTION_REASON.Duplicate,
        };
      }
      if (peers.size >= request.policy.maxConnectionsPerDocument) {
        return {
          accepted: false,
          reason: CONNECTION_REJECTION_REASON.Capacity,
        };
      }
      peers.add(request.peerId);
      let held = true;
      return {
        accepted: true,
        lease: {
          async refresh() {
            return held && peers.has(request.peerId);
          },
          async release() {
            if (!held) return;
            held = false;
            peers.delete(request.peerId);
          },
        },
      };
    },
  };
};

export const createDurableObjectRoomFanout = (): RoomFanout => {
  const handlers = new Map<string, Set<RoomFanoutHandler>>();

  return {
    async publish(event: CommittedDocumentEvent) {
      const current = [...(handlers.get(event.documentId) ?? [])];
      await Promise.allSettled(current.map((handler) => handler(event)));
    },

    async subscribe(documentId, handler) {
      const current = handlers.get(documentId) ?? new Set<RoomFanoutHandler>();
      current.add(handler);
      handlers.set(documentId, current);
      let subscribed = true;
      return {
        async unsubscribe() {
          if (!subscribed) return;
          subscribed = false;
          const active = handlers.get(documentId);
          active?.delete(handler);
          if (active?.size === 0) handlers.delete(documentId);
        },
      };
    },
  };
};
