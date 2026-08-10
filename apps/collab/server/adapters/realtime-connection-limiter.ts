import {
  CONNECTION_REJECTION_REASON,
  type ConnectionLimiter,
} from "@softmaple/collab-runtime";
import {
  documentLeaseScope,
  getRealtime,
  LeaseAcquireResult,
  type ConnectionLeaseStore,
} from "../utils/realtime";
import { logDocumentRoomError } from "./document-room-logging";

export const createRealtimeConnectionLimiter = (
  leases: ConnectionLeaseStore = getRealtime().leases,
): ConnectionLimiter => ({
  async acquire({ documentId, peerId, policy }) {
    const scope = documentLeaseScope(documentId);
    let result: LeaseAcquireResult;
    try {
      result = await leases.tryAcquire(
        scope,
        peerId,
        policy.maxConnectionsPerDocument,
        policy.leaseTtlMs,
      );
    } catch (error) {
      logDocumentRoomError(error, documentId, "lease-acquire");
      throw error;
    }
    if (result !== LeaseAcquireResult.Acquired) {
      return {
        accepted: false,
        reason:
          result === LeaseAcquireResult.Duplicate
            ? CONNECTION_REJECTION_REASON.Duplicate
            : CONNECTION_REJECTION_REASON.Capacity,
      };
    }

    let released = false;
    return {
      accepted: true,
      lease: {
        async refresh() {
          if (released) return false;
          try {
            return await leases.refresh(scope, peerId, policy.leaseTtlMs);
          } catch (error) {
            logDocumentRoomError(error, documentId, "lease-refresh");
            throw error;
          }
        },
        async release() {
          if (released) return;
          released = true;
          try {
            await leases.release(scope, peerId);
          } catch (error) {
            logDocumentRoomError(error, documentId, "lease-release");
            throw error;
          }
        },
      },
    };
  },
});
