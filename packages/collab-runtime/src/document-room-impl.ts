import {
  COLLAB_ACCESS_MODE,
  COLLAB_ERROR_CODE,
  COLLAB_MESSAGE_TYPE,
  COLLAB_PROTOCOL_VERSION,
  LEGACY_COLLAB_PROTOCOL_VERSION,
  type ClientCollabMessage,
  type CollabCredential,
  type CollabErrorCode,
  type ServerCollabMessage,
  type SupportedCollabProtocolVersion,
} from "@softmaple/collab-protocol";
import {
  DOCUMENT_SESSION_END_REASON,
  type DocumentAccess,
  type DocumentSession,
  type DocumentSessionEndReason,
} from "./document-session";
import {
  DocumentEventAuthorizationError,
  DocumentEventConflictError,
} from "./event-store";
import {
  ROOM_LEAVE_REASON,
  type DocumentRoom,
  type DocumentRoomScheduledTask,
  type DocumentRoomScheduler,
  type DocumentRoomServices,
  type RoomLeaveReason,
  type RoomPeer,
} from "./document-room";
import type { ConnectionLease, ConnectionPolicy } from "./connection-limiter";
import type { RoomFanoutSubscription } from "./room-fanout";

const CLOSE_CODE = {
  GoingAway: 1001,
  InternalError: 1011,
  PolicyViolation: 1008,
  TryAgainLater: 1013,
} as const;

const SYSTEM_SCHEDULER: DocumentRoomScheduler = Object.freeze({
  now: () => Date.now(),
  repeat(
    intervalMs: number,
    task: () => void | Promise<void>,
  ): DocumentRoomScheduledTask {
    const handle = globalThis.setInterval(() => {
      void Promise.resolve(task()).catch(() => undefined);
    }, intervalMs);
    return {
      cancel() {
        globalThis.clearInterval(handle);
      },
    };
  },
});

interface PeerState {
  readonly peer: RoomPeer;
  authenticationPending: boolean;
  authorizationExpiresAt: number;
  credential: CollabCredential | null;
  lease: ConnectionLease | null;
  leaving: boolean;
  operationTail: Promise<void>;
  pendingSession: DocumentSession | null;
  refreshPending: boolean;
  refreshTask: DocumentRoomScheduledTask | null;
  session: DocumentSession | null;
}

const errorMessage = (
  code: CollabErrorCode,
  message: string,
  retryable: boolean,
  protocolVersion: SupportedCollabProtocolVersion,
): ServerCollabMessage => ({
  protocolVersion,
  type: COLLAB_MESSAGE_TYPE.Error,
  code,
  message,
  retryable,
});

const validatePositive = (value: number, label: string): void => {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a positive finite number`);
  }
};

const validateConnectionPolicy = (policy: ConnectionPolicy): void => {
  validatePositive(
    policy.leaseRefreshIntervalMs,
    "connection.leaseRefreshIntervalMs",
  );
  validatePositive(policy.leaseTtlMs, "connection.leaseTtlMs");
  validatePositive(
    policy.maxConnectionsPerDocument,
    "connection.maxConnectionsPerDocument",
  );
  if (policy.leaseRefreshIntervalMs >= policy.leaseTtlMs) {
    throw new Error(
      "connection.leaseRefreshIntervalMs must be shorter than connection.leaseTtlMs",
    );
  }
};

const sameSessionIdentity = (
  session: DocumentSession,
  access: DocumentAccess,
): boolean =>
  session.accessMode === access.accessMode &&
  session.actorId === access.actorId;

const refreshSessionAccess = (
  session: DocumentSession,
  access: DocumentAccess,
): DocumentSession => {
  if (access.accessMode === COLLAB_ACCESS_MODE.Public) {
    return {
      accessMode: COLLAB_ACCESS_MODE.Public,
      actorId: null,
      canWrite: false,
      documentId: session.documentId,
      protocolVersion: COLLAB_PROTOCOL_VERSION,
      role: null,
      sessionId: session.sessionId,
    };
  }
  return {
    accessMode: COLLAB_ACCESS_MODE.Authenticated,
    actorId: access.actorId,
    canWrite: access.canWrite,
    documentId: session.documentId,
    protocolVersion: session.protocolVersion,
    role: access.role,
    sessionId: session.sessionId,
  };
};

const createSession = (
  documentId: string,
  sessionId: string,
  protocolVersion: SupportedCollabProtocolVersion,
  access: DocumentAccess,
): DocumentSession | null => {
  if (access.accessMode === COLLAB_ACCESS_MODE.Public) {
    if (protocolVersion === LEGACY_COLLAB_PROTOCOL_VERSION) return null;
    return {
      accessMode: COLLAB_ACCESS_MODE.Public,
      actorId: null,
      canWrite: false,
      documentId,
      protocolVersion: COLLAB_PROTOCOL_VERSION,
      role: null,
      sessionId,
    };
  }
  return {
    accessMode: COLLAB_ACCESS_MODE.Authenticated,
    actorId: access.actorId,
    canWrite: access.canWrite,
    documentId,
    protocolVersion,
    role: access.role,
    sessionId,
  };
};

const readyMessage = (session: DocumentSession): ServerCollabMessage =>
  session.protocolVersion === LEGACY_COLLAB_PROTOCOL_VERSION
    ? {
        protocolVersion: LEGACY_COLLAB_PROTOCOL_VERSION,
        type: COLLAB_MESSAGE_TYPE.Ready,
        documentId: session.documentId,
        userId: session.actorId,
        role: session.role,
        canWrite: session.canWrite,
      }
    : {
        protocolVersion: COLLAB_PROTOCOL_VERSION,
        type: COLLAB_MESSAGE_TYPE.Ready,
        accessMode: session.accessMode,
        documentId: session.documentId,
        userId: session.actorId,
        role: session.role,
        canWrite: session.canWrite,
      };

const sessionEndReason = (reason: RoomLeaveReason): DocumentSessionEndReason =>
  reason === ROOM_LEAVE_REASON.AccessRevoked
    ? DOCUMENT_SESSION_END_REASON.AccessRevoked
    : reason === ROOM_LEAVE_REASON.RuntimeShutdown
      ? DOCUMENT_SESSION_END_REASON.RoomClosed
      : DOCUMENT_SESSION_END_REASON.PeerLeft;

/**
 * Creates the runtime-independent collaboration state machine for one
 * immutable document identity.
 */
export const createDocumentRoom = (
  documentId: string,
  services: DocumentRoomServices,
): DocumentRoom => {
  if (documentId.trim().length === 0) {
    throw new Error("documentId must be a non-empty string");
  }
  validatePositive(
    services.policy.authorizationRefreshIntervalMs,
    "authorizationRefreshIntervalMs",
  );
  validateConnectionPolicy(services.policy.connection);

  const scheduler = services.scheduler ?? SYSTEM_SCHEDULER;
  const peers = new Map<string, PeerState>();
  const fanoutRetainers = new Set<string>();
  let fanoutSubscription: RoomFanoutSubscription | null = null;
  let fanoutSubscriptionPromise: Promise<RoomFanoutSubscription> | null = null;
  let closed = false;

  const safeSend = async (
    peer: RoomPeer,
    message: ServerCollabMessage,
  ): Promise<boolean> => {
    try {
      await peer.send(message);
      return true;
    } catch {
      return false;
    }
  };

  const safeClose = async (
    peer: RoomPeer,
    code: number,
    reason: string,
  ): Promise<void> => {
    try {
      await peer.close(code, reason);
    } catch {
      // The transport is already unavailable; room cleanup still proceeds.
    }
  };

  const deliverFanout = async (event: {
    readonly batches: Parameters<typeof services.events.append>[2];
    readonly documentId: string;
  }): Promise<void> => {
    if (event.documentId !== documentId || closed) return;
    const deliveries = [...peers.values()].flatMap((state) => {
      const session = state.session;
      if (state.leaving || session === null) return [];
      return [
        safeSend(state.peer, {
          protocolVersion: session.protocolVersion,
          type: COLLAB_MESSAGE_TYPE.Event,
          batches: event.batches,
        }),
      ];
    });
    await Promise.all(deliveries);
  };

  const ensureFanoutSubscription = async (): Promise<void> => {
    if (fanoutSubscription !== null) return;
    if (fanoutSubscriptionPromise === null) {
      fanoutSubscriptionPromise = services.fanout.subscribe(
        documentId,
        deliverFanout,
      );
    }
    const pending = fanoutSubscriptionPromise;
    try {
      const subscription = await pending;
      if (closed || fanoutRetainers.size === 0) {
        await subscription.unsubscribe();
        return;
      }
      fanoutSubscription = subscription;
    } finally {
      if (fanoutSubscriptionPromise === pending) {
        fanoutSubscriptionPromise = null;
      }
    }
  };

  const releaseFanoutIfIdle = async (): Promise<void> => {
    if (fanoutRetainers.size > 0) return;
    const pending = fanoutSubscriptionPromise;
    if (pending !== null) {
      await pending.catch(() => undefined);
    }
    if (fanoutRetainers.size > 0) return;
    const subscription = fanoutSubscription;
    fanoutSubscription = null;
    if (subscription !== null) {
      await subscription.unsubscribe().catch(() => undefined);
    }
  };

  const cleanupResources = async (
    state: PeerState,
    reason: DocumentSessionEndReason,
  ): Promise<void> => {
    state.refreshTask?.cancel();
    state.refreshTask = null;
    state.refreshPending = false;

    const session = state.session ?? state.pendingSession;
    state.session = null;
    state.pendingSession = null;
    state.credential = null;
    state.authorizationExpiresAt = 0;

    fanoutRetainers.delete(state.peer.id);
    await releaseFanoutIfIdle();

    const lease = state.lease;
    state.lease = null;
    if (lease !== null) {
      await lease.release().catch(() => undefined);
    }
    if (session !== null && services.sessions.end !== undefined) {
      await services.sessions.end(session, reason).catch(() => undefined);
    }
  };

  const enqueue = (
    state: PeerState,
    operation: () => Promise<void>,
  ): Promise<void> => {
    const running = state.operationTail.then(operation, operation);
    state.operationTail = running.catch(() => undefined);
    return running;
  };

  const periodicRefresh = async (state: PeerState): Promise<void> => {
    const session = state.session;
    const credential = state.credential;
    const lease = state.lease;
    if (
      closed ||
      state.leaving ||
      session === null ||
      credential === null ||
      lease === null
    ) {
      return;
    }

    try {
      const [access, leaseAlive] = await Promise.all([
        services.sessions.refresh({
          credential,
          peerId: state.peer.id,
          session,
        }),
        lease.refresh(),
      ]);
      if (closed || state.leaving || state.session !== session) return;
      if (
        access === null ||
        !sameSessionIdentity(session, access) ||
        !leaseAlive
      ) {
        await cleanupResources(
          state,
          DOCUMENT_SESSION_END_REASON.AccessRevoked,
        );
        await safeClose(
          state.peer,
          CLOSE_CODE.PolicyViolation,
          "Collaboration access was revoked",
        );
        return;
      }
      state.session = refreshSessionAccess(session, access);
      state.authorizationExpiresAt =
        scheduler.now() + services.policy.authorizationRefreshIntervalMs;
    } catch {
      if (closed || state.leaving) return;
      await cleanupResources(state, DOCUMENT_SESSION_END_REASON.PeerLeft);
      await safeClose(
        state.peer,
        CLOSE_CODE.InternalError,
        "Authorization recheck failed",
      );
    }
  };

  const scheduleRefresh = (state: PeerState): void => {
    state.refreshTask = scheduler.repeat(
      services.policy.connection.leaseRefreshIntervalMs,
      () => {
        if (
          closed ||
          state.leaving ||
          state.refreshPending ||
          state.session === null
        ) {
          return;
        }
        state.refreshPending = true;
        return enqueue(state, () => periodicRefresh(state)).finally(() => {
          state.refreshPending = false;
        });
      },
    );
  };

  const refreshForMessage = async (state: PeerState): Promise<boolean> => {
    const session = state.session;
    const credential = state.credential;
    if (session === null) return false;
    if (credential === null) {
      await safeSend(
        state.peer,
        errorMessage(
          COLLAB_ERROR_CODE.AuthenticationFailed,
          "The collaboration session is invalid",
          false,
          session.protocolVersion,
        ),
      );
      await cleanupResources(state, DOCUMENT_SESSION_END_REASON.AccessRevoked);
      await safeClose(state.peer, CLOSE_CODE.PolicyViolation, "Unauthorized");
      return false;
    }
    if (state.authorizationExpiresAt > scheduler.now()) return true;

    try {
      const access = await services.sessions.refresh({
        credential,
        peerId: state.peer.id,
        session,
      });
      if (closed || state.leaving || state.session !== session) return false;
      if (access === null || !sameSessionIdentity(session, access)) {
        await safeSend(
          state.peer,
          errorMessage(
            COLLAB_ERROR_CODE.AuthenticationFailed,
            "Authentication or document membership failed",
            false,
            session.protocolVersion,
          ),
        );
        await cleanupResources(
          state,
          DOCUMENT_SESSION_END_REASON.AccessRevoked,
        );
        await safeClose(state.peer, CLOSE_CODE.PolicyViolation, "Unauthorized");
        return false;
      }
      state.session = refreshSessionAccess(session, access);
      state.authorizationExpiresAt =
        scheduler.now() + services.policy.authorizationRefreshIntervalMs;
      return true;
    } catch {
      if (closed || state.leaving) return false;
      await safeSend(
        state.peer,
        errorMessage(
          COLLAB_ERROR_CODE.AuthenticationFailed,
          "Authentication is temporarily unavailable",
          true,
          session.protocolVersion,
        ),
      );
      await cleanupResources(state, DOCUMENT_SESSION_END_REASON.PeerLeft);
      await safeClose(
        state.peer,
        CLOSE_CODE.InternalError,
        "Authentication unavailable",
      );
      return false;
    }
  };

  const handleAuth = async (
    state: PeerState,
    message: Extract<
      ClientCollabMessage,
      { readonly type: typeof COLLAB_MESSAGE_TYPE.Auth }
    >,
  ): Promise<void> => {
    if (closed || state.leaving) return;
    if (message.documentId !== documentId) {
      await safeSend(
        state.peer,
        errorMessage(
          COLLAB_ERROR_CODE.AuthenticationFailed,
          "Authentication or document membership failed",
          false,
          message.protocolVersion,
        ),
      );
      await safeClose(state.peer, CLOSE_CODE.PolicyViolation, "Unauthorized");
      return;
    }

    const credential: CollabCredential =
      message.protocolVersion === LEGACY_COLLAB_PROTOCOL_VERSION
        ? { kind: "access-token", token: message.accessToken }
        : message.credential;
    try {
      const access = await services.sessions.authorize({
        credential,
        documentId,
        peerId: state.peer.id,
        protocolVersion: message.protocolVersion,
        sessionId: message.sessionId,
      });
      if (closed || state.leaving) return;
      if (access === null) {
        await safeSend(
          state.peer,
          errorMessage(
            COLLAB_ERROR_CODE.AuthenticationFailed,
            "Authentication or document membership failed",
            false,
            message.protocolVersion,
          ),
        );
        await safeClose(state.peer, CLOSE_CODE.PolicyViolation, "Unauthorized");
        return;
      }

      const session = createSession(
        documentId,
        message.sessionId,
        message.protocolVersion,
        access,
      );
      if (session === null) {
        await safeClose(
          state.peer,
          CLOSE_CODE.PolicyViolation,
          "Legacy public collaboration is unsupported",
        );
        return;
      }
      state.pendingSession = session;

      const admission = await services.connections.acquire({
        documentId,
        peerId: state.peer.id,
        policy: services.policy.connection,
        sessionId: message.sessionId,
      });
      if (closed || state.leaving) {
        if (admission.accepted) {
          state.lease = admission.lease;
        }
        return;
      }
      if (!admission.accepted) {
        await cleanupResources(state, DOCUMENT_SESSION_END_REASON.PeerLeft);
        await safeSend(
          state.peer,
          errorMessage(
            COLLAB_ERROR_CODE.Forbidden,
            "This document has reached its connection limit",
            true,
            message.protocolVersion,
          ),
        );
        await safeClose(
          state.peer,
          CLOSE_CODE.TryAgainLater,
          "Document connection limit reached",
        );
        return;
      }

      state.lease = admission.lease;
      fanoutRetainers.add(state.peer.id);
      await ensureFanoutSubscription();
      if (closed || state.leaving) return;

      state.session = session;
      state.pendingSession = null;
      state.credential = credential;
      state.authorizationExpiresAt =
        scheduler.now() + services.policy.authorizationRefreshIntervalMs;
      scheduleRefresh(state);
      await safeSend(state.peer, readyMessage(session));
    } catch {
      if (closed || state.leaving) return;
      await cleanupResources(state, DOCUMENT_SESSION_END_REASON.PeerLeft);
      await safeSend(
        state.peer,
        errorMessage(
          COLLAB_ERROR_CODE.AuthenticationFailed,
          "Authentication is temporarily unavailable",
          true,
          message.protocolVersion,
        ),
      );
    }
  };

  const handleRepair = async (
    state: PeerState,
    message: Extract<
      ClientCollabMessage,
      { readonly type: typeof COLLAB_MESSAGE_TYPE.RepairRequest }
    >,
  ): Promise<void> => {
    if (!(await refreshForMessage(state))) return;
    const session = state.session;
    if (session === null) return;
    try {
      const page = await services.events.read(documentId, message.afterCursor);
      if (closed || state.leaving || state.session === null) return;
      await safeSend(state.peer, {
        protocolVersion: session.protocolVersion,
        type: COLLAB_MESSAGE_TYPE.RepairResponse,
        requestId: message.requestId,
        ...page,
      });
    } catch {
      if (closed || state.leaving) return;
      await safeSend(
        state.peer,
        errorMessage(
          COLLAB_ERROR_CODE.PersistenceFailed,
          "Document history could not be loaded",
          true,
          session.protocolVersion,
        ),
      );
    }
  };

  const handleEvent = async (
    state: PeerState,
    message: Extract<
      ClientCollabMessage,
      { readonly type: typeof COLLAB_MESSAGE_TYPE.Event }
    >,
  ): Promise<void> => {
    if (!(await refreshForMessage(state))) return;
    const session = state.session;
    if (session === null) return;
    if (!session.canWrite) {
      await safeSend(
        state.peer,
        errorMessage(
          COLLAB_ERROR_CODE.Forbidden,
          "This workspace role cannot edit documents",
          false,
          session.protocolVersion,
        ),
      );
      return;
    }
    let batchIds: ReadonlyArray<string>;
    try {
      batchIds = await services.events.append(
        documentId,
        session.actorId,
        message.batches,
      );
    } catch (error) {
      if (closed || state.leaving) return;
      const conflict = error instanceof DocumentEventConflictError;
      const forbidden = error instanceof DocumentEventAuthorizationError;
      await safeSend(
        state.peer,
        errorMessage(
          forbidden
            ? COLLAB_ERROR_CODE.Forbidden
            : conflict
              ? COLLAB_ERROR_CODE.Conflict
              : COLLAB_ERROR_CODE.PersistenceFailed,
          forbidden
            ? "This workspace role cannot edit documents"
            : conflict
              ? "The event batch conflicts with stored document history"
              : "The event batch was not saved",
          !conflict && !forbidden,
          session.protocolVersion,
        ),
      );
      return;
    }

    if (!closed && !state.leaving) {
      await safeSend(state.peer, {
        protocolVersion: session.protocolVersion,
        type: COLLAB_MESSAGE_TYPE.DurableAck,
        batchIds,
      });
    }
    try {
      await services.fanout.publish({
        documentId,
        batches: message.batches,
      });
    } catch {
      // The append is already durable; clients recover missed fan-out via repair.
    }
  };

  const room: DocumentRoom = {
    documentId,
    async join(peer) {
      if (closed) throw new Error(`Document room ${documentId} is closed`);
      const existing = peers.get(peer.id);
      if (existing !== undefined) {
        if (existing.peer === peer) return;
        throw new Error(`Peer id ${peer.id} is already joined`);
      }
      peers.set(peer.id, {
        peer,
        authenticationPending: false,
        authorizationExpiresAt: 0,
        credential: null,
        lease: null,
        leaving: false,
        operationTail: Promise.resolve(),
        pendingSession: null,
        refreshPending: false,
        refreshTask: null,
        session: null,
      });
    },
    async receive(peer, message) {
      const state = peers.get(peer.id);
      if (closed || state === undefined || state.leaving) return;

      if (message.type === COLLAB_MESSAGE_TYPE.Auth) {
        const alreadyAuthenticated = state.session !== null;
        if (alreadyAuthenticated || state.authenticationPending) {
          await safeClose(
            state.peer,
            CLOSE_CODE.PolicyViolation,
            alreadyAuthenticated
              ? "Already authenticated"
              : "Authentication already in progress",
          );
          return;
        }
        state.authenticationPending = true;
        try {
          await enqueue(state, () => handleAuth(state, message));
        } finally {
          state.authenticationPending = false;
        }
        return;
      }

      if (state.session === null) {
        await safeSend(
          state.peer,
          errorMessage(
            COLLAB_ERROR_CODE.AuthenticationFailed,
            "Authenticate before sending collaboration messages",
            false,
            COLLAB_PROTOCOL_VERSION,
          ),
        );
        return;
      }

      await enqueue(state, () =>
        message.type === COLLAB_MESSAGE_TYPE.RepairRequest
          ? handleRepair(state, message)
          : handleEvent(state, message),
      );
    },
    async leave(peer, reason = ROOM_LEAVE_REASON.ConnectionClosed) {
      const state = peers.get(peer.id);
      if (state === undefined) return;
      state.leaving = true;
      await enqueue(state, async () => {
        await cleanupResources(state, sessionEndReason(reason));
        if (peers.get(peer.id) === state) peers.delete(peer.id);
      });
    },
    async close() {
      if (closed) return;
      closed = true;
      const states = [...peers.values()];
      for (const state of states) state.leaving = true;
      await Promise.all(
        states.map((state) =>
          enqueue(state, async () => {
            await safeClose(
              state.peer,
              CLOSE_CODE.GoingAway,
              "Collaboration runtime is shutting down",
            );
            await cleanupResources(
              state,
              DOCUMENT_SESSION_END_REASON.RoomClosed,
            );
            if (peers.get(state.peer.id) === state) {
              peers.delete(state.peer.id);
            }
          }),
        ),
      );
      fanoutRetainers.clear();
      await releaseFanoutIfIdle();
    },
  };

  return room;
};
