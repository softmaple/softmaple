import {
  CONNECTION_REJECTION_REASON,
  type ConnectionLease,
  type ConnectionLimiter,
} from "@softmaple/collab-runtime";
import {
  getRealtime,
  LeaseAcquireResult,
  presenceLeaseScope,
} from "../utils/realtime";

const realtimePresenceLease = (
  roomId: string,
  peerId: string,
  ttlMs: number,
): ConnectionLease => {
  const scope = presenceLeaseScope(roomId);
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
export const realtimePresenceConnectionLimiter: ConnectionLimiter = {
  async acquire(request) {
    const result = await getRealtime().leases.tryAcquire(
      presenceLeaseScope(request.documentId),
      request.peerId,
      request.policy.maxConnectionsPerDocument,
      request.policy.leaseTtlMs,
    );
    if (result === LeaseAcquireResult.Acquired) {
      return {
        accepted: true,
        lease: realtimePresenceLease(
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
