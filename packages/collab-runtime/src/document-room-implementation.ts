import {
  COLLAB_ACCESS_MODE,
  COLLAB_ERROR_CODE,
  COLLAB_MESSAGE_TYPE,
  COLLAB_PROTOCOL_VERSION,
  LEGACY_COLLAB_PROTOCOL_VERSION,
  type AuthMessage,
  type ClientCollabMessage,
  type CollabCredential,
  type CollabErrorCode,
  type LegacyAuthMessage,
  type ServerCollabMessage,
  type SupportedCollabProtocolVersion,
} from "@softmaple/collab-protocol";
import type { ConnectionLease } from "./connection-limiter";
import {
  DOCUMENT_SESSION_END_REASON,
  type DocumentAccess,
  type DocumentSession,
  type DocumentSessionEndReason,
} from "./document-session";
import type {
  DocumentRoom,
  DocumentRoomServices,
  RoomLeaveReason,
  RoomPeer,
} from "./document-room";
import { ROOM_LEAVE_REASON } from "./document-room";
import {
  DocumentEventAuthorizationError,
  DocumentEventConflictError,
} from "./event-store";
import type { RoomFanoutSubscription } from "./room-fanout";

const PEER_PHASE = {
  Authenticated: "authenticated",
  Authenticating: "authenticating",
  Joined: "joined",
  Left: "left",
} as const;

type PeerPhase = (typeof PEER_PHASE)[keyof typeof PEER_PHASE];

interface PeerState {
  authorizationExpiresAt: number;
  credential: CollabCredential | null;
  fanoutRetained: boolean;
  lease: ConnectionLease | null;
  leaseRefreshAt: number;
  leaveRequested: boolean;
  phase: PeerPhase;
  readonly peer: RoomPeer;
  queue: Promise<void>;
  refreshPending: boolean;
  refreshTimer: ReturnType<typeof setInterval> | null;
  session: DocumentSession | null;
}

const createPeerState = (peer: RoomPeer): PeerState => ({
  authorizationExpiresAt: 0,
  credential: null,
  fanoutRetained: false,
  lease: null,
  leaseRefreshAt: 0,
  leaveRequested: false,
  phase: PEER_PHASE.Joined,
  peer,
  queue: Promise.resolve(),
  refreshPending: false,
  refreshTimer: null,
  session: null,
});

const credentialFromAuth = (
  message: AuthMessage | LegacyAuthMessage,
): CollabCredential =>
  message.protocolVersion === LEGACY_COLLAB_PROTOCOL_VERSION
    ? { kind: "access-token", token: message.accessToken }
    : message.credential;

const protocolError = (
  protocolVersion: SupportedCollabProtocolVersion,
  code: CollabErrorCode,
  message: string,
  retryable: boolean,
): ServerCollabMessage => ({
  protocolVersion,
  type: COLLAB_MESSAGE_TYPE.Error,
  code,
  message,
  retryable,
});

const sessionFromAccess = (
  documentId: string,
  sessionId: string,
  protocolVersion: SupportedCollabProtocolVersion,
  access: DocumentAccess,
): DocumentSession => {
  if (access.accessMode === COLLAB_ACCESS_MODE.Public) {
    return {
      ...access,
      documentId,
      sessionId,
      protocolVersion: COLLAB_PROTOCOL_VERSION,
    };
  }
  return { ...access, documentId, sessionId, protocolVersion };
};

const accessMatchesSessionIdentity = (
  access: DocumentAccess,
  session: DocumentSession,
): boolean =>
  access.accessMode === session.accessMode &&
  access.actorId === session.actorId;

const sessionWithRefreshedAccess = (
  session: DocumentSession,
  access: DocumentAccess,
): DocumentSession =>
  sessionFromAccess(
    session.documentId,
    session.sessionId,
    session.protocolVersion,
    access,
  );

const readyMessage = (session: DocumentSession): ServerCollabMessage => {
  if (session.protocolVersion === LEGACY_COLLAB_PROTOCOL_VERSION) {
    if (
      session.accessMode !== COLLAB_ACCESS_MODE.Authenticated ||
      session.actorId === null ||
      session.role === null
    ) {
      throw new Error("Legacy collaboration requires an authenticated actor");
    }
    return {
      protocolVersion: LEGACY_COLLAB_PROTOCOL_VERSION,
      type: COLLAB_MESSAGE_TYPE.Ready,
      documentId: session.documentId,
      userId: session.actorId,
      role: session.role,
      canWrite: session.canWrite,
    };
  }
  return {
    protocolVersion: COLLAB_PROTOCOL_VERSION,
    type: COLLAB_MESSAGE_TYPE.Ready,
    accessMode: session.accessMode,
    documentId: session.documentId,
    userId: session.actorId,
    role: session.role,
    canWrite: session.canWrite,
  };
};

const endReasonFromLeave = (
  reason: RoomLeaveReason,
): DocumentSessionEndReason => {
  switch (reason) {
    case ROOM_LEAVE_REASON.AccessRevoked:
      return DOCUMENT_SESSION_END_REASON.AccessRevoked;
    case ROOM_LEAVE_REASON.RuntimeShutdown:
      return DOCUMENT_SESSION_END_REASON.RoomClosed;
    case ROOM_LEAVE_REASON.ConnectionClosed:
      return DOCUMENT_SESSION_END_REASON.PeerLeft;
  }
};

class RuntimeDocumentRoom implements DocumentRoom {
  readonly documentId: string;

  private closed = false;
  private closePromise: Promise<void> | null = null;
  private fanoutQueue: Promise<void> = Promise.resolve();
  private fanoutRetainers = 0;
  private fanoutSubscription: RoomFanoutSubscription | null = null;
  private readonly peers = new Map<RoomPeer, PeerState>();
  private readonly services: DocumentRoomServices;

  constructor(documentId: string, services: DocumentRoomServices) {
    if (documentId.length === 0) {
      throw new Error("DocumentRoom requires a non-empty document id");
    }
    this.assertPolicy(services);
    this.documentId = documentId;
    this.services = services;
  }

  async join(peer: RoomPeer): Promise<void> {
    if (this.closed) {
      await this.closePeer(
        peer,
        1012,
        "Collaboration runtime is shutting down",
      );
      return;
    }
    if (!this.peers.has(peer)) this.peers.set(peer, createPeerState(peer));
  }

  async receive(peer: RoomPeer, message: ClientCollabMessage): Promise<void> {
    const state = this.peers.get(peer);
    if (state === undefined || state.phase === PEER_PHASE.Left) {
      await this.sendIgnoringFailure(
        peer,
        protocolError(
          COLLAB_PROTOCOL_VERSION,
          COLLAB_ERROR_CODE.AuthenticationFailed,
          "Authenticate before sending collaboration messages",
          false,
        ),
        "pre-auth",
      );
      return;
    }

    if (message.type === COLLAB_MESSAGE_TYPE.Auth) {
      await this.receiveAuth(state, message);
      return;
    }

    if (state.phase !== PEER_PHASE.Authenticated) {
      await this.sendIgnoringFailure(
        peer,
        protocolError(
          COLLAB_PROTOCOL_VERSION,
          COLLAB_ERROR_CODE.AuthenticationFailed,
          "Authenticate before sending collaboration messages",
          false,
        ),
        message.type,
      );
      return;
    }

    await this.enqueue(state, async () => {
      if (state.phase !== PEER_PHASE.Authenticated || state.leaveRequested) {
        return;
      }
      if (!(await this.refreshAuthorizationForMessage(state, message.type))) {
        return;
      }
      if (message.type === COLLAB_MESSAGE_TYPE.RepairRequest) {
        await this.receiveRepair(state, message);
        return;
      }
      await this.receiveEvent(state, message);
    });
  }

  async leave(
    peer: RoomPeer,
    reason: RoomLeaveReason = ROOM_LEAVE_REASON.ConnectionClosed,
  ): Promise<void> {
    const state = this.peers.get(peer);
    if (state === undefined) return;
    state.leaveRequested = true;
    await this.enqueue(state, async () => {
      await this.resetState(state, true, endReasonFromLeave(reason));
    });
  }

  close(): Promise<void> {
    if (this.closePromise !== null) return this.closePromise;
    this.closed = true;
    this.closePromise = this.closeRoom();
    return this.closePromise;
  }

  private async closeRoom(): Promise<void> {
    const states = [...this.peers.values()];
    for (const state of states) state.leaveRequested = true;
    await Promise.all(
      states.map(async (state) => {
        await this.closePeer(
          state.peer,
          1012,
          "Collaboration runtime is shutting down",
        );
        await this.enqueue(state, async () => {
          await this.resetState(
            state,
            true,
            DOCUMENT_SESSION_END_REASON.RoomClosed,
          );
        });
      }),
    );
    await this.withFanoutLock(async () => {
      const subscription = this.fanoutSubscription;
      this.fanoutSubscription = null;
      this.fanoutRetainers = 0;
      if (subscription !== null) {
        await this.unsubscribeFanout(subscription, null);
      }
    });
  }

  private async receiveAuth(
    state: PeerState,
    message: AuthMessage | LegacyAuthMessage,
  ): Promise<void> {
    if (state.phase !== PEER_PHASE.Joined) {
      const reason =
        state.phase === PEER_PHASE.Authenticating
          ? "Authentication already in progress"
          : "Already authenticated";
      state.leaveRequested = true;
      await this.closePeer(state.peer, 1008, reason);
      // Do not wait behind the in-flight authorization provider call: the
      // duplicate Auth must be rejected immediately. The queued rollback still
      // releases any resources acquired by the first attempt.
      void this.enqueue(state, async () => {
        await this.resetState(
          state,
          true,
          DOCUMENT_SESSION_END_REASON.PeerLeft,
        );
      }).catch((error: unknown) => {
        this.report(error, state, "auth-cleanup");
      });
      return;
    }

    // Set synchronously so a concurrent second Auth observes the pending state.
    state.phase = PEER_PHASE.Authenticating;
    await this.enqueue(state, async () => {
      await this.authenticate(state, message);
    });
  }

  private async authenticate(
    state: PeerState,
    message: AuthMessage | LegacyAuthMessage,
  ): Promise<void> {
    if (message.documentId !== this.documentId) {
      await this.sendIgnoringFailure(
        state.peer,
        protocolError(
          message.protocolVersion,
          COLLAB_ERROR_CODE.AuthenticationFailed,
          "Authentication or document membership failed",
          false,
        ),
        message.type,
      );
      await this.closePeer(state.peer, 1008, "Unauthorized");
      await this.resetState(
        state,
        true,
        DOCUMENT_SESSION_END_REASON.AccessRevoked,
      );
      return;
    }

    const credential = credentialFromAuth(message);
    let access: DocumentAccess | null;
    try {
      access = await this.services.sessions.authorize({
        credential,
        documentId: this.documentId,
        peerId: state.peer.id,
        protocolVersion: message.protocolVersion,
        sessionId: message.sessionId,
      });
    } catch (error) {
      await this.failTemporaryAuthentication(state, message, error);
      return;
    }

    if (state.leaveRequested || this.closed) {
      await this.resetState(
        state,
        true,
        this.closed
          ? DOCUMENT_SESSION_END_REASON.RoomClosed
          : DOCUMENT_SESSION_END_REASON.PeerLeft,
      );
      return;
    }
    if (access === null) {
      await this.sendIgnoringFailure(
        state.peer,
        protocolError(
          message.protocolVersion,
          COLLAB_ERROR_CODE.AuthenticationFailed,
          "Authentication or document membership failed",
          false,
        ),
        message.type,
      );
      await this.closePeer(state.peer, 1008, "Unauthorized");
      await this.resetState(
        state,
        true,
        DOCUMENT_SESSION_END_REASON.AccessRevoked,
      );
      return;
    }
    if (
      message.protocolVersion === LEGACY_COLLAB_PROTOCOL_VERSION &&
      access.accessMode !== COLLAB_ACCESS_MODE.Authenticated
    ) {
      await this.closePeer(
        state.peer,
        1008,
        "Legacy public collaboration is unsupported",
      );
      await this.resetState(
        state,
        true,
        DOCUMENT_SESSION_END_REASON.AccessRevoked,
      );
      return;
    }

    try {
      const admission = await this.services.connections.acquire({
        documentId: this.documentId,
        peerId: state.peer.id,
        policy: this.services.policy.connection,
        sessionId: message.sessionId,
      });
      if (!admission.accepted) {
        await this.sendIgnoringFailure(
          state.peer,
          protocolError(
            message.protocolVersion,
            COLLAB_ERROR_CODE.Forbidden,
            "This document has reached its connection limit",
            true,
          ),
          message.type,
        );
        await this.closePeer(
          state.peer,
          1013,
          "Document connection limit reached",
        );
        await this.resetState(
          state,
          true,
          DOCUMENT_SESSION_END_REASON.PeerLeft,
        );
        return;
      }
      state.lease = admission.lease;
      if (state.leaveRequested || this.closed) {
        await this.resetState(
          state,
          true,
          this.closed
            ? DOCUMENT_SESSION_END_REASON.RoomClosed
            : DOCUMENT_SESSION_END_REASON.PeerLeft,
        );
        return;
      }

      await this.retainFanout(state);
      if (state.leaveRequested || this.closed) {
        await this.resetState(
          state,
          true,
          this.closed
            ? DOCUMENT_SESSION_END_REASON.RoomClosed
            : DOCUMENT_SESSION_END_REASON.PeerLeft,
        );
        return;
      }

      const session = sessionFromAccess(
        this.documentId,
        message.sessionId,
        message.protocolVersion,
        access,
      );
      state.credential = credential;
      state.session = session;
      state.authorizationExpiresAt =
        Date.now() + this.services.policy.authorizationRefreshIntervalMs;
      state.leaseRefreshAt =
        Date.now() + this.services.policy.connection.leaseRefreshIntervalMs;
      state.phase = PEER_PHASE.Authenticated;
      this.startRefreshTimer(state);
      await state.peer.send(readyMessage(session));
    } catch (error) {
      await this.failTemporaryAuthentication(state, message, error);
    }
  }

  private async failTemporaryAuthentication(
    state: PeerState,
    message: AuthMessage | LegacyAuthMessage,
    error: unknown,
  ): Promise<void> {
    this.report(error, state, message.type);
    const shouldRemove = state.leaveRequested || this.closed;
    await this.resetState(
      state,
      shouldRemove,
      this.closed
        ? DOCUMENT_SESSION_END_REASON.RoomClosed
        : DOCUMENT_SESSION_END_REASON.PeerLeft,
    );
    if (shouldRemove) return;
    await this.sendIgnoringFailure(
      state.peer,
      protocolError(
        message.protocolVersion,
        COLLAB_ERROR_CODE.AuthenticationFailed,
        "Authentication is temporarily unavailable",
        true,
      ),
      message.type,
    );
  }

  private async refreshAuthorizationForMessage(
    state: PeerState,
    messageType: string,
  ): Promise<boolean> {
    if (state.authorizationExpiresAt > Date.now()) return true;
    const session = state.session;
    const credential = state.credential;
    if (session === null || credential === null) return false;

    let access: DocumentAccess | null;
    try {
      access = await this.services.sessions.refresh({
        credential,
        peerId: state.peer.id,
        session,
      });
    } catch (error) {
      this.report(error, state, messageType);
      await this.sendIgnoringFailure(
        state.peer,
        protocolError(
          session.protocolVersion,
          COLLAB_ERROR_CODE.AuthenticationFailed,
          "Authentication is temporarily unavailable",
          true,
        ),
        messageType,
      );
      await this.closePeer(state.peer, 1011, "Authentication unavailable");
      await this.resetState(state, true, DOCUMENT_SESSION_END_REASON.PeerLeft);
      return false;
    }

    if (access === null || !accessMatchesSessionIdentity(access, session)) {
      await this.sendIgnoringFailure(
        state.peer,
        protocolError(
          session.protocolVersion,
          COLLAB_ERROR_CODE.AuthenticationFailed,
          "Authentication or document membership failed",
          false,
        ),
        messageType,
      );
      await this.closePeer(state.peer, 1008, "Unauthorized");
      await this.resetState(
        state,
        true,
        DOCUMENT_SESSION_END_REASON.AccessRevoked,
      );
      return false;
    }

    state.session = sessionWithRefreshedAccess(session, access);
    state.authorizationExpiresAt =
      Date.now() + this.services.policy.authorizationRefreshIntervalMs;
    return true;
  }

  private async receiveRepair(
    state: PeerState,
    message: Extract<
      ClientCollabMessage,
      { readonly type: typeof COLLAB_MESSAGE_TYPE.RepairRequest }
    >,
  ): Promise<void> {
    const session = state.session;
    if (session === null) return;
    try {
      const page = await this.services.events.read(
        this.documentId,
        message.afterCursor,
      );
      await this.sendIgnoringFailure(
        state.peer,
        {
          protocolVersion: session.protocolVersion,
          type: COLLAB_MESSAGE_TYPE.RepairResponse,
          requestId: message.requestId,
          ...page,
        },
        message.type,
      );
    } catch (error) {
      this.report(error, state, message.type);
      await this.sendIgnoringFailure(
        state.peer,
        protocolError(
          session.protocolVersion,
          COLLAB_ERROR_CODE.PersistenceFailed,
          "Document history could not be loaded",
          true,
        ),
        message.type,
      );
    }
  }

  private async receiveEvent(
    state: PeerState,
    message: Extract<
      ClientCollabMessage,
      { readonly type: typeof COLLAB_MESSAGE_TYPE.Event }
    >,
  ): Promise<void> {
    const session = state.session;
    if (session === null) return;
    if (!session.canWrite) {
      await this.sendIgnoringFailure(
        state.peer,
        protocolError(
          session.protocolVersion,
          COLLAB_ERROR_CODE.Forbidden,
          "This workspace role cannot edit documents",
          false,
        ),
        message.type,
      );
      return;
    }
    let batchIds: ReadonlyArray<string>;
    try {
      batchIds = await this.services.events.append(
        this.documentId,
        session.actorId,
        message.batches,
      );
    } catch (error) {
      this.report(error, state, message.type);
      const authorization = error instanceof DocumentEventAuthorizationError;
      const conflict = error instanceof DocumentEventConflictError;
      await this.sendIgnoringFailure(
        state.peer,
        protocolError(
          session.protocolVersion,
          authorization
            ? COLLAB_ERROR_CODE.Forbidden
            : conflict
              ? COLLAB_ERROR_CODE.Conflict
              : COLLAB_ERROR_CODE.PersistenceFailed,
          authorization
            ? "This workspace role cannot edit documents"
            : conflict
              ? "The event batch conflicts with stored document history"
              : "The event batch was not saved",
          !authorization && !conflict,
        ),
        message.type,
      );
      return;
    }

    // A durable append must fan out even if the origin disconnects while the
    // write is in flight. A failed acknowledgement send is therefore isolated.
    await this.sendIgnoringFailure(
      state.peer,
      {
        protocolVersion: session.protocolVersion,
        type: COLLAB_MESSAGE_TYPE.DurableAck,
        batchIds,
      },
      message.type,
    );
    try {
      await this.services.fanout.publish({
        documentId: this.documentId,
        batches: message.batches,
      });
    } catch (error) {
      this.report(error, state, "realtime-publish");
    }
  }

  private startRefreshTimer(state: PeerState): void {
    if (state.refreshTimer !== null) clearInterval(state.refreshTimer);
    const cadence = Math.min(
      this.services.policy.authorizationRefreshIntervalMs,
      this.services.policy.connection.leaseRefreshIntervalMs,
    );
    state.refreshTimer = setInterval(() => {
      if (state.refreshPending || state.phase !== PEER_PHASE.Authenticated) {
        return;
      }
      state.refreshPending = true;
      void this.enqueue(state, async () => {
        await this.periodicRefresh(state);
      })
        .catch((error: unknown) => {
          this.report(error, state, "authorization-recheck");
        })
        .finally(() => {
          state.refreshPending = false;
        });
    }, cadence);
  }

  private async periodicRefresh(state: PeerState): Promise<void> {
    if (state.phase !== PEER_PHASE.Authenticated || state.leaveRequested) {
      return;
    }
    const session = state.session;
    const credential = state.credential;
    const lease = state.lease;
    if (session === null || credential === null || lease === null) return;

    const now = Date.now();
    const refreshAuthorization = state.authorizationExpiresAt <= now;
    const refreshLease = state.leaseRefreshAt <= now;
    if (!refreshAuthorization && !refreshLease) return;

    try {
      const [access, leaseAlive] = await Promise.all([
        refreshAuthorization
          ? this.services.sessions.refresh({
              credential,
              peerId: state.peer.id,
              session,
            })
          : Promise.resolve<DocumentAccess | null>(
              this.accessFromSession(session),
            ),
        refreshLease ? lease.refresh() : Promise.resolve(true),
      ]);
      if (state.leaveRequested || state.phase !== PEER_PHASE.Authenticated) {
        return;
      }
      if (
        access === null ||
        !accessMatchesSessionIdentity(access, session) ||
        !leaseAlive
      ) {
        await this.closePeer(
          state.peer,
          1008,
          "Collaboration access was revoked",
        );
        await this.resetState(
          state,
          true,
          DOCUMENT_SESSION_END_REASON.AccessRevoked,
        );
        return;
      }
      state.session = sessionWithRefreshedAccess(session, access);
      if (refreshAuthorization) {
        state.authorizationExpiresAt =
          now + this.services.policy.authorizationRefreshIntervalMs;
      }
      if (refreshLease) {
        state.leaseRefreshAt =
          now + this.services.policy.connection.leaseRefreshIntervalMs;
      }
    } catch (error) {
      this.report(error, state, "authorization-recheck");
      await this.closePeer(state.peer, 1011, "Authorization recheck failed");
      await this.resetState(state, true, DOCUMENT_SESSION_END_REASON.PeerLeft);
    }
  }

  private accessFromSession(session: DocumentSession): DocumentAccess {
    if (session.accessMode === COLLAB_ACCESS_MODE.Public) {
      return {
        accessMode: COLLAB_ACCESS_MODE.Public,
        actorId: null,
        canWrite: false,
        role: null,
      };
    }
    return {
      accessMode: COLLAB_ACCESS_MODE.Authenticated,
      actorId: session.actorId,
      canWrite: session.canWrite,
      role: session.role,
    };
  }

  private async retainFanout(state: PeerState): Promise<void> {
    await this.withFanoutLock(async () => {
      if (this.fanoutRetainers === 0) {
        this.fanoutSubscription = await this.services.fanout.subscribe(
          this.documentId,
          async (event) => {
            if (event.documentId !== this.documentId) return;
            const recipients = [...this.peers.values()].filter(
              (candidate) =>
                candidate.phase === PEER_PHASE.Authenticated &&
                !candidate.leaveRequested &&
                candidate.session !== null,
            );
            await Promise.all(
              recipients.map(async (recipient) => {
                const session = recipient.session;
                if (session === null) return;
                await this.sendIgnoringFailure(
                  recipient.peer,
                  {
                    protocolVersion: session.protocolVersion,
                    type: COLLAB_MESSAGE_TYPE.Event,
                    batches: event.batches,
                  },
                  "realtime-fanout",
                );
              }),
            );
          },
        );
      }
      this.fanoutRetainers += 1;
      state.fanoutRetained = true;
    });
  }

  private async releaseFanout(state: PeerState): Promise<void> {
    if (!state.fanoutRetained) return;
    state.fanoutRetained = false;
    await this.withFanoutLock(async () => {
      this.fanoutRetainers = Math.max(0, this.fanoutRetainers - 1);
      if (this.fanoutRetainers !== 0) return;
      const subscription = this.fanoutSubscription;
      this.fanoutSubscription = null;
      if (subscription !== null) {
        await this.unsubscribeFanout(subscription, state);
      }
    });
  }

  private async unsubscribeFanout(
    subscription: RoomFanoutSubscription,
    state: PeerState | null,
  ): Promise<void> {
    try {
      await subscription.unsubscribe();
    } catch (error) {
      this.report(error, state, "fanout-unsubscribe");
    }
  }

  private async resetState(
    state: PeerState,
    remove: boolean,
    endReason: DocumentSessionEndReason,
  ): Promise<void> {
    if (state.refreshTimer !== null) {
      clearInterval(state.refreshTimer);
      state.refreshTimer = null;
    }
    state.refreshPending = false;

    await this.releaseFanout(state);
    const lease = state.lease;
    state.lease = null;
    if (lease !== null) {
      try {
        await lease.release();
      } catch (error) {
        this.report(error, state, "lease-release");
      }
    }

    const session = state.session;
    state.session = null;
    state.credential = null;
    state.authorizationExpiresAt = 0;
    state.leaseRefreshAt = 0;
    if (session !== null && this.services.sessions.end !== undefined) {
      try {
        await this.services.sessions.end(session, endReason);
      } catch (error) {
        this.report(error, state, "session-end");
      }
    }

    if (remove) {
      state.phase = PEER_PHASE.Left;
      this.peers.delete(state.peer);
    } else {
      state.phase = PEER_PHASE.Joined;
      state.leaveRequested = false;
    }
  }

  private enqueue(state: PeerState, work: () => Promise<void>): Promise<void> {
    const operation = state.queue.then(work, work);
    state.queue = operation.catch(() => undefined);
    return operation;
  }

  private withFanoutLock(work: () => Promise<void>): Promise<void> {
    const operation = this.fanoutQueue.then(work, work);
    this.fanoutQueue = operation.catch(() => undefined);
    return operation;
  }

  private async sendIgnoringFailure(
    peer: RoomPeer,
    message: ServerCollabMessage,
    messageType: string,
  ): Promise<void> {
    try {
      await peer.send(message);
    } catch (error) {
      this.report(error, this.peers.get(peer) ?? null, messageType);
    }
  }

  private async closePeer(
    peer: RoomPeer,
    code: number,
    reason: string,
  ): Promise<void> {
    try {
      await peer.close(code, reason);
    } catch (error) {
      this.report(error, this.peers.get(peer) ?? null, "peer-close");
    }
  }

  private report(
    error: unknown,
    state: PeerState | null,
    messageType: string,
  ): void {
    try {
      this.services.reportError?.(error, {
        documentId: this.documentId,
        messageType,
        ...(state === null ? {} : { peerId: state.peer.id }),
      });
    } catch {
      // Observability must never change room behavior.
    }
  }

  private assertPolicy(services: DocumentRoomServices): void {
    const values = [
      services.policy.authorizationRefreshIntervalMs,
      services.policy.connection.leaseRefreshIntervalMs,
      services.policy.connection.leaseTtlMs,
      services.policy.connection.maxConnectionsPerDocument,
    ];
    if (values.some((value) => !Number.isFinite(value) || value <= 0)) {
      throw new Error("DocumentRoom policy values must be positive");
    }
    if (
      services.policy.connection.leaseRefreshIntervalMs >=
      services.policy.connection.leaseTtlMs
    ) {
      throw new Error("Connection lease refresh must be shorter than its TTL");
    }
  }
}

export const createDocumentRoom = (
  documentId: string,
  services: DocumentRoomServices,
): DocumentRoom => new RuntimeDocumentRoom(documentId, services);
