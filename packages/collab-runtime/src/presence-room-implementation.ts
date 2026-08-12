import type { CollabCredential } from "@softmaple/collab-protocol";
import type { ConnectionLease } from "./connection-limiter";
import { ROOM_LEAVE_REASON, type RoomLeaveReason } from "./document-room";
import {
  PRESENCE_FRAME,
  PRESENCE_MESSAGE,
  type PresenceEnvelope,
  type PresenceMessageKind,
  type PresencePatch,
} from "./presence-codec";
import type { PresenceFanoutSubscription } from "./presence-fanout";
import {
  PRESENCE_ROOM_REFRESH_MODE,
  type PresencePeer,
  type PresenceRoom,
  type PresenceRoomOptions,
  type PresenceRoomRefreshMode,
  type PresenceRoomResumeState,
  type PresenceRoomServices,
} from "./presence-room";
import {
  PRESENCE_SESSION_END_REASON,
  type PresenceIdentity,
  type PresenceSession,
  type PresenceSessionEndReason,
} from "./presence-session";
import type { PresenceMemberRecord } from "./presence-store";

const PEER_PHASE = {
  Authenticated: "authenticated",
  Authenticating: "authenticating",
  Connected: "connected",
  Joined: "joined",
  Left: "left",
} as const;

type PeerPhase = (typeof PEER_PHASE)[keyof typeof PEER_PHASE];

interface PeerState {
  authorizationExpiresAt: number;
  connectionId: string | null;
  credential: CollabCredential | null;
  fanoutRetained: boolean;
  heartbeatExpiresAt: number;
  heartbeatTimer: ReturnType<typeof setTimeout> | null;
  identity: PresenceIdentity | null;
  joined: boolean;
  lease: ConnectionLease | null;
  leaveRequested: boolean;
  phase: PeerPhase;
  readonly peer: PresencePeer;
  queue: Promise<void>;
  queuePending: number;
  rateLimit: unknown;
}

const createPeerState = (peer: PresencePeer): PeerState => ({
  authorizationExpiresAt: 0,
  connectionId: null,
  credential: null,
  fanoutRetained: false,
  heartbeatExpiresAt: 0,
  heartbeatTimer: null,
  identity: null,
  joined: false,
  lease: null,
  leaveRequested: false,
  phase: PEER_PHASE.Connected,
  peer,
  queue: Promise.resolve(),
  queuePending: 0,
  rateLimit: null,
});

const unrefTimer = (timer: ReturnType<typeof setTimeout>): void => {
  const candidate = timer as unknown as { unref?: () => void };
  candidate.unref?.();
};

const endReasonFromLeave = (
  reason: RoomLeaveReason,
): PresenceSessionEndReason => {
  switch (reason) {
    case ROOM_LEAVE_REASON.AccessRevoked:
      return PRESENCE_SESSION_END_REASON.AccessRevoked;
    case ROOM_LEAVE_REASON.RuntimeShutdown:
      return PRESENCE_SESSION_END_REASON.RoomClosed;
    case ROOM_LEAVE_REASON.ConnectionClosed:
      return PRESENCE_SESSION_END_REASON.PeerLeft;
  }
};

class RuntimePresenceRoom implements PresenceRoom {
  readonly roomId: string;

  private closed = false;
  private closePromise: Promise<void> | null = null;
  private fanoutQueue: Promise<void> = Promise.resolve();
  private fanoutRetainers = 0;
  private fanoutSubscription: PresenceFanoutSubscription | null = null;
  private messageMaintenanceQueue: Promise<void> = Promise.resolve();
  private readonly peers = new Map<PresencePeer, PeerState>();
  private readonly refreshMode: PresenceRoomRefreshMode;
  private readonly services: PresenceRoomServices;

  constructor(
    roomId: string,
    services: PresenceRoomServices,
    options: PresenceRoomOptions = {},
  ) {
    if (roomId.length === 0) {
      throw new Error("PresenceRoom requires a non-empty room id");
    }
    this.assertPolicy(services);
    this.roomId = roomId;
    this.refreshMode =
      options.refreshMode ?? PRESENCE_ROOM_REFRESH_MODE.Background;
    this.services = services;
  }

  async join(peer: PresencePeer): Promise<void> {
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

  async resume(
    peer: PresencePeer,
    resumed: PresenceRoomResumeState,
  ): Promise<PresenceSession | null> {
    await this.join(peer);
    const state = this.peers.get(peer);
    if (state === undefined || this.closed) return null;

    if (state.phase !== PEER_PHASE.Connected) {
      state.leaveRequested = true;
      await this.closePeer(peer, 1008, "Already authenticated");
      await this.enqueue(state, async () => {
        await this.resetState(
          state,
          true,
          PRESENCE_SESSION_END_REASON.PeerLeft,
        );
      });
      return null;
    }

    state.phase = PEER_PHASE.Authenticating;
    return this.enqueue(state, async () => this.resumeSession(state, resumed));
  }

  async receive(peer: PresencePeer, rawMessage: string): Promise<void> {
    if (this.closed) return;
    const state = this.peers.get(peer);
    if (
      state === undefined ||
      state.leaveRequested ||
      state.phase === PEER_PHASE.Left
    ) {
      return;
    }

    let quota: { allowed: boolean; state: unknown };
    try {
      quota = this.services.codec.consumeQuota(state.rateLimit, Date.now());
    } catch (error) {
      this.report(error, state, "quota-check");
      state.leaveRequested = true;
      await this.closePeer(peer, 1011, "Presence rate limit check failed");
      await this.enqueue(state, async () => {
        await this.resetState(
          state,
          true,
          PRESENCE_SESSION_END_REASON.PeerLeft,
        );
      });
      return;
    }
    state.rateLimit = quota.state;
    await this.persistSnapshot(state);
    if (!quota.allowed) {
      state.leaveRequested = true;
      await this.closePeer(peer, 1013, "Presence rate limit exceeded");
      await this.enqueue(state, async () => {
        await this.resetState(
          state,
          true,
          PRESENCE_SESSION_END_REASON.PeerLeft,
        );
      });
      return;
    }

    let envelope: PresenceEnvelope;
    try {
      envelope = this.services.codec.parseEnvelope(JSON.parse(rawMessage));
    } catch {
      try {
        await this.sendIgnoringFailure(
          peer,
          this.services.codec.encode(PRESENCE_FRAME.Error, "unknown", "server", {
            code: "invalid-message",
            message: "The presence message is invalid",
          }),
          "invalid-message",
        );
      } catch (encodeError) {
        this.report(encodeError, state, "error-frame-encode");
      }
      return;
    }

    if (envelope.roomId !== this.roomId) {
      state.leaveRequested = true;
      await this.closePeer(peer, 1008, "Presence room mismatch");
      await this.enqueue(state, async () => {
        await this.resetState(
          state,
          true,
          PRESENCE_SESSION_END_REASON.PeerLeft,
        );
      });
      return;
    }

    let kind: PresenceMessageKind;
    try {
      kind = this.services.codec.classify(envelope);
    } catch {
      state.leaveRequested = true;
      await this.closePeer(peer, 1008, "Unsupported presence message");
      await this.enqueue(state, async () => {
        await this.resetState(
          state,
          true,
          PRESENCE_SESSION_END_REASON.PeerLeft,
        );
      });
      return;
    }

    if (kind === PRESENCE_MESSAGE.Auth) {
      await this.receiveAuth(state, envelope);
      return;
    }

    if (
      state.phase !== PEER_PHASE.Authenticated &&
      state.phase !== PEER_PHASE.Joined
    ) {
      state.leaveRequested = true;
      await this.closePeer(peer, 1008, "Authenticate presence first");
      await this.enqueue(state, async () => {
        await this.resetState(
          state,
          true,
          PRESENCE_SESSION_END_REASON.PeerLeft,
        );
      });
      return;
    }
    if (
      state.connectionId === null ||
      envelope.senderId !== state.connectionId
    ) {
      state.leaveRequested = true;
      await this.closePeer(peer, 1008, "Presence sender mismatch");
      await this.enqueue(state, async () => {
        await this.resetState(
          state,
          true,
          PRESENCE_SESSION_END_REASON.PeerLeft,
        );
      });
      return;
    }

    await this.enqueue(state, async () => {
      if (!this.isPeerLive(state)) return;
      if (!(await this.refreshAuthorizationForMessage(state))) return;
      if (!this.isPeerLive(state)) return;

      // Rearm the heartbeat BEFORE acquiring the maintenance lock. If we swept
      // before rearming, this peer might be found expired, and sweepLocked would
      // enqueue work on the same peer that is already holding its queue lock,
      // causing a deadlock. By rearming first, the calling peer is guaranteed
      // never to appear in the expired-heartbeats list.
      await this.rearmHeartbeat(state);

      if (this.refreshMode === PRESENCE_ROOM_REFRESH_MODE.OnMessage) {
        await this.withMessageMaintenanceLock(async () => {
          await this.sweepLocked(Date.now(), state);
        });
        if (!this.isPeerLive(state)) return;
      }

      switch (kind) {
        case PRESENCE_MESSAGE.Join:
          await this.receiveJoin(state);
          return;
        case PRESENCE_MESSAGE.Sync:
          await this.receiveSync(state);
          return;
        case PRESENCE_MESSAGE.Heartbeat:
          await this.receiveHeartbeat(state, envelope);
          return;
        case PRESENCE_MESSAGE.Update:
          await this.receiveUpdate(state, envelope);
          return;
        case PRESENCE_MESSAGE.Leave:
          await this.receiveLeave(state);
          return;
      }
    });
  }

  async leave(
    peer: PresencePeer,
    reason: RoomLeaveReason = ROOM_LEAVE_REASON.ConnectionClosed,
  ): Promise<void> {
    const state = this.peers.get(peer);
    if (state === undefined) return;
    state.leaveRequested = true;
    this.clearHeartbeatTimer(state);
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

  async sweep(now: number = Date.now()): Promise<void> {
    await this.withMessageMaintenanceLock(async () => {
      await this.sweepLocked(now, null);
    });
  }

  private async closeRoom(): Promise<void> {
    const states = [...this.peers.values()];
    for (const state of states) state.leaveRequested = true;
    await Promise.all(
      states.map(async (state) => {
        this.clearHeartbeatTimer(state);
        await this.closePeer(
          state.peer,
          1012,
          "Collaboration runtime is shutting down",
        );
        await this.enqueue(state, async () => {
          await this.resetState(
            state,
            true,
            PRESENCE_SESSION_END_REASON.RoomClosed,
          );
        });
      }),
    );
    await this.withFanoutLock(async () => {
      const subscription = this.fanoutSubscription;
      this.fanoutRetainers = 0;
      if (
        subscription !== null &&
        (await this.unsubscribeFanout(subscription))
      ) {
        this.fanoutSubscription = null;
      }
    });
  }

  private async receiveAuth(
    state: PeerState,
    envelope: PresenceEnvelope,
  ): Promise<void> {
    if (state.phase !== PEER_PHASE.Connected) {
      state.leaveRequested = true;
      await this.closePeer(
        state.peer,
        1008,
        "Presence is already authenticated",
      );
      void this.enqueue(state, async () => {
        await this.resetState(
          state,
          true,
          PRESENCE_SESSION_END_REASON.PeerLeft,
        );
      }).catch((error: unknown) => {
        this.report(error, state, "auth-cleanup");
      });
      return;
    }

    // Set synchronously so a concurrent second Auth observes the pending state.
    state.phase = PEER_PHASE.Authenticating;
    await this.enqueue(state, async () => {
      await this.authenticate(state, envelope);
    });
  }

  private async authenticate(
    state: PeerState,
    envelope: PresenceEnvelope,
  ): Promise<void> {
    try {
      const auth = this.services.codec.parseAuth(envelope.payload);
      if (envelope.senderId !== auth.connectionId) {
        throw new Error("presence sender mismatch");
      }

      const identity = await this.services.sessions.authorize({
        connectionId: auth.connectionId,
        credential: auth.credential,
        roomId: this.roomId,
        userId: auth.userId,
      });
      if (identity === null) {
        throw new Error("presence membership denied");
      }

      if (state.leaveRequested || this.closed) {
        await this.resetState(
          state,
          true,
          this.closed
            ? PRESENCE_SESSION_END_REASON.RoomClosed
            : PRESENCE_SESSION_END_REASON.PeerLeft,
        );
        return;
      }

      // Set before admission so a concurrent cleanup can identify the peer.
      state.connectionId = auth.connectionId;
      const admission = await this.services.connections.acquire({
        documentId: this.roomId,
        peerId: auth.connectionId,
        policy: this.services.policy.connection,
        sessionId: auth.connectionId,
      });
      if (!admission.accepted) {
        state.leaveRequested = true;
        await this.closePeer(
          state.peer,
          1013,
          "Presence room is full or duplicated",
        );
        await this.resetState(
          state,
          true,
          PRESENCE_SESSION_END_REASON.PeerLeft,
        );
        return;
      }
      state.lease = admission.lease;
      if (state.leaveRequested || this.closed) {
        await this.resetState(
          state,
          true,
          this.closed
            ? PRESENCE_SESSION_END_REASON.RoomClosed
            : PRESENCE_SESSION_END_REASON.PeerLeft,
        );
        return;
      }

      try {
        await this.retainFanout(state);
      } catch (fanoutError) {
        this.report(fanoutError, state, "auth-fanout");
        state.leaveRequested = true;
        await this.closePeer(state.peer, 1011, "Presence runtime unavailable");
        await this.resetState(
          state,
          true,
          PRESENCE_SESSION_END_REASON.PeerLeft,
        );
        return;
      }
      if (state.leaveRequested || this.closed) {
        await this.resetState(
          state,
          true,
          this.closed
            ? PRESENCE_SESSION_END_REASON.RoomClosed
            : PRESENCE_SESSION_END_REASON.PeerLeft,
        );
        return;
      }

      state.credential = auth.credential;
      state.identity = identity;
      state.authorizationExpiresAt =
        Date.now() + this.services.policy.authorizationRefreshIntervalMs;
      state.phase = PEER_PHASE.Authenticated;
      await this.persistSnapshot(state);
      await this.sendIgnoringFailure(
        state.peer,
        this.services.codec.encode(
          PRESENCE_FRAME.AuthOk,
          this.roomId,
          "server",
          {},
        ),
        "auth-ok",
      );
    } catch (error) {
      this.report(error, state, "auth");
      state.leaveRequested = true;
      await this.resetState(
        state,
        true,
        PRESENCE_SESSION_END_REASON.AccessRevoked,
      );
      await this.sendIgnoringFailure(
        state.peer,
        this.services.codec.encode(
          PRESENCE_FRAME.AuthError,
          this.roomId,
          "server",
          { message: "Authentication or document membership failed" },
        ),
        "auth-error",
      );
      await this.closePeer(state.peer, 1008, "Unauthorized");
    }
  }

  private async resumeSession(
    state: PeerState,
    resumed: PresenceRoomResumeState,
  ): Promise<PresenceSession | null> {
    let refreshed: PresenceIdentity | null;
    try {
      refreshed = await this.services.sessions.refresh({
        connectionId: resumed.connectionId,
        credential: resumed.credential,
        session: {
          connectionId: resumed.connectionId,
          identity: resumed.identity,
          roomId: this.roomId,
        },
      });
    } catch (error) {
      this.report(error, state, "session-resume");
      state.leaveRequested = true;
      await this.closePeer(state.peer, 1011, "Presence runtime unavailable");
      await this.resetState(state, true, PRESENCE_SESSION_END_REASON.PeerLeft);
      return null;
    }

    if (state.leaveRequested || this.closed) {
      await this.resetState(
        state,
        true,
        this.closed
          ? PRESENCE_SESSION_END_REASON.RoomClosed
          : PRESENCE_SESSION_END_REASON.PeerLeft,
      );
      return null;
    }
    if (refreshed === null || refreshed.userId !== resumed.identity.userId) {
      state.leaveRequested = true;
      await this.closePeer(state.peer, 1008, "Presence access was revoked");
      await this.resetState(
        state,
        true,
        PRESENCE_SESSION_END_REASON.AccessRevoked,
      );
      return null;
    }

    state.connectionId = resumed.connectionId;
    state.credential = resumed.credential;
    state.identity = refreshed;
    state.joined = resumed.joined;
    state.rateLimit = resumed.rateLimit;
    state.heartbeatExpiresAt = resumed.heartbeatExpiresAt;

    try {
      const admission = await this.services.connections.acquire({
        documentId: this.roomId,
        peerId: resumed.connectionId,
        policy: this.services.policy.connection,
        sessionId: resumed.connectionId,
      });
      if (!admission.accepted) {
        state.leaveRequested = true;
        await this.closePeer(
          state.peer,
          1013,
          "Presence connection lease was lost",
        );
        await this.resetState(
          state,
          true,
          PRESENCE_SESSION_END_REASON.PeerLeft,
        );
        return null;
      }
      state.lease = admission.lease;
      if (state.leaveRequested || this.closed) {
        await this.resetState(
          state,
          true,
          this.closed
            ? PRESENCE_SESSION_END_REASON.RoomClosed
            : PRESENCE_SESSION_END_REASON.PeerLeft,
        );
        return null;
      }

      await this.retainFanout(state);
      if (state.leaveRequested || this.closed) {
        await this.resetState(
          state,
          true,
          this.closed
            ? PRESENCE_SESSION_END_REASON.RoomClosed
            : PRESENCE_SESSION_END_REASON.PeerLeft,
        );
        return null;
      }

      state.authorizationExpiresAt =
        Date.now() + this.services.policy.authorizationRefreshIntervalMs;
      state.phase = state.joined ? PEER_PHASE.Joined : PEER_PHASE.Authenticated;
      if (
        this.refreshMode === PRESENCE_ROOM_REFRESH_MODE.Background &&
        state.heartbeatExpiresAt > 0
      ) {
        this.rearmHeartbeatTimer(state);
      }
      return {
        connectionId: state.connectionId,
        identity: refreshed,
        roomId: this.roomId,
      };
    } catch (error) {
      this.report(error, state, "session-resume");
      state.leaveRequested = true;
      await this.closePeer(state.peer, 1011, "Presence runtime unavailable");
      await this.resetState(state, true, PRESENCE_SESSION_END_REASON.PeerLeft);
      return null;
    }
  }

  private async refreshAuthorizationForMessage(
    state: PeerState,
  ): Promise<boolean> {
    if (state.authorizationExpiresAt > Date.now()) return true;
    const credential = state.credential;
    const identity = state.identity;
    const connectionId = state.connectionId;
    if (credential === null || identity === null || connectionId === null) {
      return false;
    }

    let refreshed: PresenceIdentity | null;
    try {
      refreshed = await this.services.sessions.refresh({
        connectionId,
        credential,
        session: { connectionId, identity, roomId: this.roomId },
      });
    } catch (error) {
      this.report(error, state, "authorization-recheck");
      state.leaveRequested = true;
      await this.resetState(state, true, PRESENCE_SESSION_END_REASON.PeerLeft);
      await this.closePeer(state.peer, 1011, "Authorization recheck failed");
      return false;
    }

    if (state.leaveRequested || state.phase === PEER_PHASE.Left) return false;
    if (refreshed === null || refreshed.userId !== identity.userId) {
      state.leaveRequested = true;
      await this.resetState(
        state,
        true,
        PRESENCE_SESSION_END_REASON.AccessRevoked,
      );
      await this.closePeer(
        state.peer,
        1008,
        "Workspace membership was revoked",
      );
      return false;
    }

    state.identity = refreshed;
    state.authorizationExpiresAt =
      Date.now() + this.services.policy.authorizationRefreshIntervalMs;
    await this.persistSnapshot(state);
    return true;
  }

  private async receiveJoin(state: PeerState): Promise<void> {
    if (state.phase !== PEER_PHASE.Authenticated) {
      state.leaveRequested = true;
      await this.closePeer(state.peer, 1008, "Presence already joined");
      await this.resetState(state, true, PRESENCE_SESSION_END_REASON.PeerLeft);
      return;
    }
    const identity = state.identity;
    const connectionId = state.connectionId;
    if (identity === null || connectionId === null) return;

    const now = Date.now();
    let member: PresenceMemberRecord;
    try {
      member = this.services.codec.createMember(identity, connectionId, now);
    } catch (error) {
      this.report(error, state, "create-member");
      state.leaveRequested = true;
      await this.resetState(state, true, PRESENCE_SESSION_END_REASON.PeerLeft);
      await this.closePeer(state.peer, 1011, "Presence join failed");
      return;
    }
    try {
      await this.services.store.setMember(
        this.roomId,
        member,
        this.services.policy.memberTtlMs,
      );
      const leaseAlive =
        state.lease !== null ? await state.lease.refresh() : true;
      if (!leaseAlive) {
        state.leaveRequested = true;
        await this.resetState(
          state,
          true,
          PRESENCE_SESSION_END_REASON.PeerLeft,
        );
        await this.closePeer(state.peer, 1008, "Presence lease expired");
        return;
      }
      state.joined = true;
      await this.persistSnapshot(state);
      state.phase = PEER_PHASE.Joined;
      await this.services.fanout.publish({
        roomId: this.roomId,
        frame: this.services.codec.encode(
          PRESENCE_FRAME.Join,
          this.roomId,
          connectionId,
          member,
        ),
      });
    } catch (error) {
      this.report(error, state, "join");
      state.leaveRequested = true;
      await this.resetState(state, true, PRESENCE_SESSION_END_REASON.PeerLeft);
      await this.closePeer(state.peer, 1011, "Presence join failed");
    }
  }

  private async receiveSync(state: PeerState): Promise<void> {
    try {
      const page = await this.services.store.listMembers(this.roomId);
      for (const expired of page.expired) {
        await this.publishLeave(expired.connectionId, expired.userId);
      }
      const members = page.members.filter((value) =>
        this.services.codec.isMember(value),
      );
      await this.sendIgnoringFailure(
        state.peer,
        this.services.codec.encode(
          PRESENCE_FRAME.SyncResponse,
          this.roomId,
          "server",
          members,
        ),
        "sync",
      );
    } catch (error) {
      this.report(error, state, "sync");
      state.leaveRequested = true;
      await this.resetState(state, true, PRESENCE_SESSION_END_REASON.PeerLeft);
      await this.closePeer(state.peer, 1011, "Presence sync failed");
    }
  }

  private async receiveHeartbeat(
    state: PeerState,
    envelope: PresenceEnvelope,
  ): Promise<void> {
    let pingId: string;
    try {
      pingId = this.services.codec.parseHeartbeat(envelope.payload);
    } catch {
      state.leaveRequested = true;
      await this.resetState(state, true, PRESENCE_SESSION_END_REASON.PeerLeft);
      await this.closePeer(state.peer, 1008, "Invalid presence heartbeat");
      return;
    }

    const connectionId = state.connectionId;
    if (connectionId === null) return;
    try {
      const leaseAlive =
        state.lease !== null ? await state.lease.refresh() : false;
      const presenceAlive = await this.services.store.refreshMember(
        this.roomId,
        connectionId,
        this.services.policy.memberTtlMs,
      );
      if (!leaseAlive || (state.joined && !presenceAlive)) {
        state.leaveRequested = true;
        await this.resetState(
          state,
          true,
          PRESENCE_SESSION_END_REASON.PeerLeft,
        );
        await this.closePeer(state.peer, 1008, "Presence lease expired");
        return;
      }
      await this.sendIgnoringFailure(
        state.peer,
        this.services.codec.encode(
          PRESENCE_FRAME.HeartbeatAck,
          this.roomId,
          connectionId,
          { pingId },
        ),
        "heartbeat",
      );
    } catch (error) {
      this.report(error, state, "heartbeat");
      state.leaveRequested = true;
      await this.resetState(state, true, PRESENCE_SESSION_END_REASON.PeerLeft);
      await this.closePeer(state.peer, 1011, "Presence heartbeat failed");
    }
  }

  private async receiveUpdate(
    state: PeerState,
    envelope: PresenceEnvelope,
  ): Promise<void> {
    const connectionId = state.connectionId;
    const identity = state.identity;
    if (connectionId === null || identity === null) return;

    let current: PresenceMemberRecord;
    try {
      const currentRaw = await this.services.store.getMember(
        this.roomId,
        connectionId,
      );
      if (!this.services.codec.isMember(currentRaw)) {
        state.leaveRequested = true;
        await this.resetState(
          state,
          true,
          PRESENCE_SESSION_END_REASON.PeerLeft,
        );
        await this.closePeer(state.peer, 1008, "Join presence before updating");
        return;
      }
      current = currentRaw;
    } catch (error) {
      this.report(error, state, "update");
      state.leaveRequested = true;
      await this.resetState(state, true, PRESENCE_SESSION_END_REASON.PeerLeft);
      await this.closePeer(state.peer, 1011, "Presence update failed");
      return;
    }

    let patch: PresencePatch;
    try {
      patch = this.services.codec.parsePatch(envelope.payload);
      if (
        patch.connectionId !== connectionId ||
        patch.userId !== identity.userId
      ) {
        throw new Error("presence identity mismatch");
      }
    } catch {
      state.leaveRequested = true;
      await this.resetState(state, true, PRESENCE_SESSION_END_REASON.PeerLeft);
      await this.closePeer(state.peer, 1008, "Invalid presence update");
      return;
    }

    if (patch.clock <= current.clock) return; // Stale write; silently dropped.
    if (patch.clock > current.clock + 1_000) {
      state.leaveRequested = true;
      await this.resetState(state, true, PRESENCE_SESSION_END_REASON.PeerLeft);
      await this.closePeer(state.peer, 1008, "Invalid presence update");
      return;
    }

    try {
      const now = Date.now();
      const application = this.services.codec.applyPatch(current, patch, now);
      await this.services.store.setMember(
        this.roomId,
        application.member,
        this.services.policy.memberTtlMs,
      );
      const leaseAlive =
        state.lease !== null ? await state.lease.refresh() : true;
      if (!leaseAlive) {
        state.leaveRequested = true;
        await this.resetState(
          state,
          true,
          PRESENCE_SESSION_END_REASON.PeerLeft,
        );
        await this.closePeer(state.peer, 1008, "Presence lease expired");
        return;
      }
      await this.services.fanout.publish({
        roomId: this.roomId,
        frame: this.services.codec.encode(
          PRESENCE_FRAME.Update,
          this.roomId,
          connectionId,
          {
            clock: patch.clock,
            connectionId,
            updates: application.broadcastPayload,
            userId: identity.userId,
          },
        ),
      });
    } catch (error) {
      this.report(error, state, "update");
      state.leaveRequested = true;
      await this.resetState(state, true, PRESENCE_SESSION_END_REASON.PeerLeft);
      await this.closePeer(state.peer, 1011, "Presence update failed");
    }
  }

  private async receiveLeave(state: PeerState): Promise<void> {
    state.leaveRequested = true;
    await this.closePeer(state.peer, 1000, "Presence left");
    await this.resetState(state, true, PRESENCE_SESSION_END_REASON.PeerLeft);
  }

  private async publishLeave(
    connectionId: string,
    userId: string,
  ): Promise<void> {
    await this.services.fanout.publish({
      roomId: this.roomId,
      frame: this.services.codec.encode(
        PRESENCE_FRAME.Leave,
        this.roomId,
        connectionId,
        { connectionId, userId },
      ),
    });
  }

  private async sweepLocked(
    now: number,
    callingPeer: PeerState | null,
  ): Promise<void> {
    const expiredHeartbeats = [...this.peers.values()].filter(
      (state) =>
        state !== callingPeer &&
        (state.phase === PEER_PHASE.Authenticated ||
          state.phase === PEER_PHASE.Joined) &&
        !state.leaveRequested &&
        state.heartbeatExpiresAt > 0 &&
        state.heartbeatExpiresAt <= now,
    );
    await Promise.all(
      expiredHeartbeats.map(async (state) => {
        state.leaveRequested = true;
        this.clearHeartbeatTimer(state);
        await this.closePeer(state.peer, 1001, "Presence heartbeat expired");
        await this.enqueue(state, async () => {
          await this.resetState(
            state,
            true,
            PRESENCE_SESSION_END_REASON.PeerLeft,
          );
        });
      }),
    );

    try {
      const page = await this.services.store.listMembers(this.roomId);
      for (const expired of page.expired) {
        await this.publishLeave(expired.connectionId, expired.userId);
      }
    } catch (error) {
      this.report(error, null, "sweep");
    }
  }

  private async rearmHeartbeat(state: PeerState): Promise<void> {
    state.heartbeatExpiresAt =
      Date.now() + this.services.policy.heartbeatExpiryMs;
    await this.persistSnapshot(state);
    if (this.refreshMode === PRESENCE_ROOM_REFRESH_MODE.Background) {
      this.rearmHeartbeatTimer(state);
    }
  }

  private rearmHeartbeatTimer(state: PeerState): void {
    this.clearHeartbeatTimer(state);
    const delay = Math.max(0, state.heartbeatExpiresAt - Date.now());
    state.heartbeatTimer = setTimeout(() => {
      state.heartbeatTimer = null;
      void this.closeExpiredHeartbeatPeer(state).catch((error: unknown) => {
        this.report(error, state, "heartbeat-expiry");
      });
    }, delay);
    unrefTimer(state.heartbeatTimer);
  }

  /**
   * Wrapped in a call so TypeScript does not (incorrectly) treat a prior
   * identical check earlier in the same async function as still valid after
   * an intervening `await` mutates `state.phase`.
   */
  private isPeerLive(state: PeerState): boolean {
    return !state.leaveRequested && state.phase !== PEER_PHASE.Left;
  }

  private clearHeartbeatTimer(state: PeerState): void {
    if (state.heartbeatTimer !== null) {
      clearTimeout(state.heartbeatTimer);
      state.heartbeatTimer = null;
    }
  }

  private async closeExpiredHeartbeatPeer(state: PeerState): Promise<void> {
    if (
      (state.phase !== PEER_PHASE.Authenticated &&
        state.phase !== PEER_PHASE.Joined) ||
      state.leaveRequested
    ) {
      return;
    }
    state.leaveRequested = true;
    await this.closePeer(state.peer, 1001, "Presence heartbeat expired");
    await this.enqueue(state, async () => {
      await this.resetState(state, true, PRESENCE_SESSION_END_REASON.PeerLeft);
    });
  }

  private async persistSnapshot(state: PeerState): Promise<void> {
    const persist = state.peer.persist;
    if (persist === undefined) return;
    if (
      state.connectionId === null ||
      state.credential === null ||
      state.identity === null
    ) {
      return;
    }
    try {
      await persist.call(state.peer, {
        authorizationExpiresAt: state.authorizationExpiresAt,
        connectionId: state.connectionId,
        credential: state.credential,
        heartbeatExpiresAt: state.heartbeatExpiresAt,
        identity: state.identity,
        joined: state.joined,
        rateLimit: state.rateLimit,
      });
    } catch (error) {
      this.report(error, state, "persist");
    }
  }

  private async retainFanout(state: PeerState): Promise<void> {
    await this.withFanoutLock(async () => {
      if (this.fanoutRetainers === 0) {
        if (this.fanoutSubscription !== null) {
          const stale = this.fanoutSubscription;
          if (!(await this.unsubscribeFanout(stale))) {
            throw new Error(
              "Previous presence fanout subscription is still active",
            );
          }
          if (this.fanoutSubscription === stale) this.fanoutSubscription = null;
        }
        this.fanoutSubscription = await this.services.fanout.subscribe(
          this.roomId,
          async (broadcast) => {
            if (broadcast.roomId !== this.roomId) return;
            const recipients = [...this.peers.values()].filter(
              (candidate) =>
                candidate.phase === PEER_PHASE.Joined &&
                !candidate.leaveRequested,
            );
            await Promise.all(
              recipients.map(async (recipient) => {
                await this.sendIgnoringFailure(
                  recipient.peer,
                  broadcast.frame,
                  "presence-fanout",
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
      if (
        subscription !== null &&
        (await this.unsubscribeFanout(subscription)) &&
        this.fanoutSubscription === subscription
      ) {
        this.fanoutSubscription = null;
      }
    });
  }

  private async unsubscribeFanout(
    subscription: PresenceFanoutSubscription,
  ): Promise<boolean> {
    try {
      await subscription.unsubscribe();
      return true;
    } catch (error) {
      this.report(error, null, "fanout-unsubscribe");
      return false;
    }
  }

  private async resetState(
    state: PeerState,
    remove: boolean,
    endReason: PresenceSessionEndReason,
  ): Promise<void> {
    this.clearHeartbeatTimer(state);
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

    const connectionId = state.connectionId;
    let removedMember: unknown = null;
    if (connectionId !== null) {
      try {
        removedMember = await this.services.store.removeMember(
          this.roomId,
          connectionId,
        );
      } catch (error) {
        this.report(error, state, "member-remove");
      }
    }
    const wasJoined = state.joined || removedMember !== null;

    const identity = state.identity;
    const session: PresenceSession | null =
      identity === null || connectionId === null
        ? null
        : { connectionId, identity, roomId: this.roomId };

    state.identity = null;
    state.credential = null;
    state.authorizationExpiresAt = 0;
    state.heartbeatExpiresAt = 0;
    state.rateLimit = null;
    state.joined = false;

    if (session !== null && this.services.sessions.end !== undefined) {
      try {
        await this.services.sessions.end(session, endReason);
      } catch (error) {
        this.report(error, state, "session-end");
      }
    }

    if (wasJoined && connectionId !== null && identity !== null) {
      try {
        await this.publishLeave(connectionId, identity.userId);
      } catch (error) {
        this.report(error, state, "leave-publish");
      }
    }

    state.connectionId = null;

    if (remove) {
      state.phase = PEER_PHASE.Left;
      this.peers.delete(state.peer);
    } else {
      state.phase = PEER_PHASE.Connected;
      state.leaveRequested = false;
    }
  }

  private enqueue<T>(state: PeerState, work: () => Promise<T>): Promise<T> {
    state.queuePending += 1;
    const operation = state.queue.then(work, work).finally(() => {
      state.queuePending -= 1;
    });
    state.queue = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  private withMessageMaintenanceLock(work: () => Promise<void>): Promise<void> {
    const operation = this.messageMaintenanceQueue.then(work, work);
    this.messageMaintenanceQueue = operation.catch(() => undefined);
    return operation;
  }

  private withFanoutLock(work: () => Promise<void>): Promise<void> {
    const operation = this.fanoutQueue.then(work, work);
    this.fanoutQueue = operation.catch(() => undefined);
    return operation;
  }

  private async sendIgnoringFailure(
    peer: PresencePeer,
    frame: unknown,
    messageType: string,
  ): Promise<void> {
    try {
      await peer.send(frame);
    } catch (error) {
      this.report(error, this.peers.get(peer) ?? null, messageType);
    }
  }

  private async closePeer(
    peer: PresencePeer,
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
        messageType,
        roomId: this.roomId,
        ...(state === null ? {} : { peerId: state.peer.id }),
      });
    } catch {
      // Observability must never change room behavior.
    }
  }

  private assertPolicy(services: PresenceRoomServices): void {
    const { policy } = services;
    const values = [
      policy.authorizationRefreshIntervalMs,
      policy.heartbeatExpiryMs,
      policy.memberTtlMs,
      policy.connection.leaseRefreshIntervalMs,
      policy.connection.leaseTtlMs,
      policy.connection.maxConnectionsPerDocument,
    ];
    if (values.some((value) => !Number.isFinite(value) || value <= 0)) {
      throw new Error("PresenceRoom policy values must be positive");
    }
    if (
      policy.connection.leaseRefreshIntervalMs >= policy.connection.leaseTtlMs
    ) {
      throw new Error(
        "Presence connection lease refresh must be shorter than its TTL",
      );
    }
  }
}

export const createPresenceRoom = (
  roomId: string,
  services: PresenceRoomServices,
  options?: PresenceRoomOptions,
): PresenceRoom => new RuntimePresenceRoom(roomId, services, options);
