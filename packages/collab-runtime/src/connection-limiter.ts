export const CONNECTION_REJECTION_REASON = {
  Capacity: "capacity",
  Duplicate: "duplicate",
} as const;

export type ConnectionRejectionReason =
  (typeof CONNECTION_REJECTION_REASON)[keyof typeof CONNECTION_REJECTION_REASON];

export interface ConnectionAdmissionRequest {
  readonly documentId: string;
  /** Stable server-side identity for this physical connection. */
  readonly peerId: string;
  readonly policy: ConnectionPolicy;
  /** Client correlation only; reconnects may reuse a session id. */
  readonly sessionId: string;
}

export interface ConnectionPolicy {
  /** All values are positive; refresh must be shorter than the lease TTL. */
  readonly leaseRefreshIntervalMs: number;
  readonly leaseTtlMs: number;
  readonly maxConnectionsPerDocument: number;
}

/**
 * A runtime-owned permit that supports expiring distributed leases. A false
 * refresh means the permit is no longer held; release must be idempotent.
 */
export interface ConnectionLease {
  refresh(): Promise<boolean>;
  release(): Promise<void>;
}

export type ConnectionAdmission =
  | {
      readonly accepted: true;
      readonly lease: ConnectionLease;
    }
  | {
      readonly accepted: false;
      /** Duplicate refers to peerId, never to the reconnectable sessionId. */
      readonly reason: ConnectionRejectionReason;
    };

/** Applies per-document connection policy without exposing its backend. */
export interface ConnectionLimiter {
  acquire(request: ConnectionAdmissionRequest): Promise<ConnectionAdmission>;
}
