import {
  CONNECTION_REJECTION_REASON,
  type ConnectionLease,
  type ConnectionLimiter,
} from "@softmaple/collab-runtime";
import {
  documentLeaseScope,
  getRealtime,
  LeaseAcquireResult,
} from "../utils/realtime";

const realtimeConnectionLease = (
  documentId: string,
  peerId: string,
  ttlMs: number,
): ConnectionLease => {
  const scope = documentLeaseScope(documentId);
  let released = false;
  return {
    async refresh() {
      if (released) return false;
      return getRealtime().leases.refresh(scope, peerId, ttlMs);
    },

    async release() {
      if (released) return;
      released = true;
      await getRealtime().leases.release(scope, peerId);
    },
  };
};

/** Redis/memory distributed connection leases behind the runtime limiter port. */
export const realtimeConnectionLimiter: ConnectionLimiter = {
  async acquire(request) {
    const result = await getRealtime().leases.tryAcquire(
      documentLeaseScope(request.documentId),
      request.peerId,
      request.policy.maxConnectionsPerDocument,
      request.policy.leaseTtlMs,
    );
    if (result === LeaseAcquireResult.Acquired) {
      return {
        accepted: true,
        lease: realtimeConnectionLease(
          request.documentId,
          request.peerId,
          request.policy.leaseTtlMs,
        ),
      };
    }
    return {
      accepted: false,
      reason:
        result === LeaseAcquireResult.Duplicate
          ? CONNECTION_REJECTION_REASON.Duplicate
          : CONNECTION_REJECTION_REASON.Capacity,
    };
  },
};
