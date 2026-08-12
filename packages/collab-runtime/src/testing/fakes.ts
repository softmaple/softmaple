import type { CollabCredential } from "@softmaple/collab-protocol";
import {
  CONNECTION_REJECTION_REASON,
  type ConnectionLimiter,
} from "../connection-limiter";
import {
  PRESENCE_MESSAGE,
  type PresenceCodec,
  type PresenceEnvelope,
  type PresencePatch,
} from "../presence-codec";
import type {
  PresenceBroadcast,
  PresenceFanout,
  PresenceFanoutHandler,
} from "../presence-fanout";
import type { PresencePeer, PresencePeerSnapshot } from "../presence-room";
import type {
  PresenceIdentity,
  PresenceSession,
  PresenceSessionAuthorizationRequest,
  PresenceSessionEndReason,
  PresenceSessionHooks,
  PresenceSessionRefreshRequest,
} from "../presence-session";
import type {
  ExpiredPresenceMember,
  PresenceMemberRecord,
  PresenceStore,
} from "../presence-store";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Same purge-on-read TTL semantics as the Redis/Durable Object stores under test. */
export const createMemoryPresenceStore = (): PresenceStore => {
  const rooms = new Map<
    string,
    Map<string, { readonly expiresAt: number; readonly member: unknown }>
  >();

  const purge = (
    roomId: string,
    now: number,
  ): {
    readonly entries: Map<string, { expiresAt: number; member: unknown }>;
    readonly expired: ExpiredPresenceMember[];
  } => {
    const entries =
      rooms.get(roomId) ??
      new Map<string, { expiresAt: number; member: unknown }>();
    const expired: ExpiredPresenceMember[] = [];
    for (const [connectionId, entry] of entries) {
      if (entry.expiresAt <= now) {
        entries.delete(connectionId);
        const userId =
          isRecord(entry.member) && typeof entry.member.userId === "string"
            ? entry.member.userId
            : connectionId;
        expired.push({ connectionId, userId });
      }
    }
    if (entries.size === 0) rooms.delete(roomId);
    else rooms.set(roomId, entries);
    return { entries, expired };
  };

  return {
    async getMember(roomId, connectionId) {
      const { entries } = purge(roomId, Date.now());
      return entries.get(connectionId)?.member ?? null;
    },
    async listMembers(roomId) {
      const { entries, expired } = purge(roomId, Date.now());
      return {
        expired,
        members: [...entries.values()].map((entry) => entry.member),
      };
    },
    async refreshMember(roomId, connectionId, ttlMs) {
      const { entries } = purge(roomId, Date.now());
      const current = entries.get(connectionId);
      if (current === undefined) return false;
      entries.set(connectionId, {
        member: current.member,
        expiresAt: Date.now() + ttlMs,
      });
      rooms.set(roomId, entries);
      return true;
    },
    async removeMember(roomId, connectionId) {
      const { entries } = purge(roomId, Date.now());
      const current = entries.get(connectionId);
      if (current === undefined) return null;
      if (current.expiresAt <= Date.now()) return null;
      entries.delete(connectionId);
      if (entries.size === 0) rooms.delete(roomId);
      else rooms.set(roomId, entries);
      return current.member;
    },
    async setMember(roomId, member, ttlMs) {
      const { entries } = purge(roomId, Date.now());
      entries.set(member.connectionId, {
        member,
        expiresAt: Date.now() + ttlMs,
      });
      rooms.set(roomId, entries);
    },
  };
};

/** Loopback-preserving cross-instance broadcast fake, scoped per room id. */
export const createMemoryPresenceFanout = (): PresenceFanout => {
  const handlers = new Map<string, Set<PresenceFanoutHandler>>();

  return {
    async publish(broadcast: PresenceBroadcast) {
      const subscribers = handlers.get(broadcast.roomId);
      if (subscribers === undefined) return;
      await Promise.all([...subscribers].map((handler) => handler(broadcast)));
    },
    async subscribe(roomId, handler) {
      const subscribers =
        handlers.get(roomId) ?? new Set<PresenceFanoutHandler>();
      subscribers.add(handler);
      handlers.set(roomId, subscribers);
      let subscribed = true;
      return {
        async unsubscribe() {
          if (!subscribed) return;
          subscribed = false;
          const current = handlers.get(roomId);
          current?.delete(handler);
          if (current?.size === 0) handlers.delete(roomId);
        },
      };
    },
  };
};

export interface MemoryConnectionLimiterOptions {
  /** Overrides the per-request policy ceiling; pass Infinity for an unlimited fake. */
  readonly maxConnectionsPerDocument?: number;
}

/** In-memory admission fake respecting capacity, duplicates, and lease TTL. */
export const createMemoryConnectionLimiter = (
  options: MemoryConnectionLimiterOptions = {},
): ConnectionLimiter => {
  const rooms = new Map<
    string,
    Map<string, { expiresAt: number; token: number }>
  >();
  let nextToken = 1;

  const purge = (
    documentId: string,
    now: number,
  ): Map<string, { expiresAt: number; token: number }> => {
    const entries =
      rooms.get(documentId) ??
      new Map<string, { expiresAt: number; token: number }>();
    for (const [peerId, entry] of entries) {
      if (entry.expiresAt <= now) entries.delete(peerId);
    }
    if (entries.size === 0) rooms.delete(documentId);
    else rooms.set(documentId, entries);
    return entries;
  };

  return {
    async acquire(request) {
      const now = Date.now();
      const entries = purge(request.documentId, now);
      if (entries.has(request.peerId)) {
        return {
          accepted: false,
          reason: CONNECTION_REJECTION_REASON.Duplicate,
        };
      }
      const capacity =
        options.maxConnectionsPerDocument ??
        request.policy.maxConnectionsPerDocument;
      if (entries.size >= capacity) {
        return {
          accepted: false,
          reason: CONNECTION_REJECTION_REASON.Capacity,
        };
      }
      const token = nextToken++;
      entries.set(request.peerId, {
        expiresAt: now + request.policy.leaseTtlMs,
        token,
      });
      rooms.set(request.documentId, entries);
      let released = false;
      return {
        accepted: true,
        lease: {
          async refresh() {
            if (released) return false;
            const live = purge(request.documentId, Date.now());
            const entry = live.get(request.peerId);
            if (entry === undefined || entry.token !== token) return false;
            live.set(request.peerId, {
              expiresAt: Date.now() + request.policy.leaseTtlMs,
              token,
            });
            rooms.set(request.documentId, live);
            return true;
          },
          async release() {
            if (released) return;
            released = true;
            const live = rooms.get(request.documentId);
            const entry = live?.get(request.peerId);
            if (
              entry !== undefined &&
              entry.token === token &&
              live !== undefined
            ) {
              live.delete(request.peerId);
              if (live.size === 0) {
                rooms.delete(request.documentId);
              }
            }
          },
        },
      };
    },
  };
};

export interface RecordingPresencePeer extends PresencePeer {
  readonly closes: Array<{ readonly code: number; readonly reason: string }>;
  readonly persisted: Array<PresencePeerSnapshot>;
  /** Mutable so a test can clear it (`peer.sent.length = 0`) between assertions. */
  readonly sent: unknown[];
  closeImpl: (code: number, reason: string) => Promise<void>;
  sendImpl: (frame: unknown) => Promise<void>;
}

/** Records sends/closes/persisted snapshots; `closeImpl`/`sendImpl` inject faults. */
export const createRecordingPresencePeer = (
  id: string,
): RecordingPresencePeer => {
  const closes: Array<{ code: number; reason: string }> = [];
  const persisted: PresencePeerSnapshot[] = [];
  const sent: unknown[] = [];

  const peer: RecordingPresencePeer = {
    id,
    closes,
    persisted,
    sent,
    closeImpl: async () => undefined,
    sendImpl: async () => undefined,
    async close(code, reason) {
      closes.push({ code, reason });
      await peer.closeImpl(code, reason);
    },
    async send(frame) {
      await peer.sendImpl(frame);
      sent.push(frame);
    },
    async persist(snapshot) {
      persisted.push(snapshot);
    },
  };
  return peer;
};

export interface StubPresenceSessionHooks extends PresenceSessionHooks {
  readonly ends: ReadonlyArray<{
    readonly reason: PresenceSessionEndReason;
    readonly session: PresenceSession;
  }>;
  authorizeImpl: (
    request: PresenceSessionAuthorizationRequest,
  ) => Promise<PresenceIdentity | null>;
  refreshImpl: (
    request: PresenceSessionRefreshRequest,
  ) => Promise<PresenceIdentity | null>;
}

/** Authorizes any userId with a deterministic identity; override the *Impl hooks to test failure paths. */
export const createStubPresenceSessionHooks = (): StubPresenceSessionHooks => {
  const ends: Array<{
    reason: PresenceSessionEndReason;
    session: PresenceSession;
  }> = [];

  const hooks: StubPresenceSessionHooks = {
    ends,
    authorizeImpl: async (request) => ({
      name: `User ${request.userId}`,
      userId: request.userId,
    }),
    refreshImpl: async (request) => request.session.identity,
    async authorize(request) {
      return hooks.authorizeImpl(request);
    },
    async refresh(request) {
      return hooks.refreshImpl(request);
    },
    async end(session, reason) {
      ends.push({ reason, session });
    },
  };
  return hooks;
};

/** The wire type strings `createOpaqueTestCodec` understands. */
export const TEST_PRESENCE_WIRE_TYPE = {
  Auth: "test:auth",
  Heartbeat: "test:heartbeat",
  Join: "test:join",
  Leave: "test:leave",
  Sync: "test:sync",
  Update: "test:update",
} as const;

interface TestMemberRecord extends PresenceMemberRecord {
  readonly extra?: unknown;
  readonly name: string;
}

interface TestPatchPayload {
  readonly extra?: unknown;
}

/**
 * A self-contained `PresenceCodec` with its own dependency-free wire format
 * (`TEST_PRESENCE_WIRE_TYPE`). This is what lets PR1's own tests run before
 * `@softmaple/awareness/protocol` exists — the codec is a capability rather
 * than a direct import.
 */
export const createOpaqueTestCodec = (): PresenceCodec => ({
  applyPatch(current, patch) {
    const extra = (patch as PresencePatch & TestPatchPayload).extra;
    const currentAsTestMember = current as unknown as TestMemberRecord;
    const currentName =
      typeof currentAsTestMember.name === "string"
        ? currentAsTestMember.name
        : current.userId;
    const member: TestMemberRecord = {
      clock: patch.clock,
      connectionId: current.connectionId,
      name: currentName,
      userId: current.userId,
      ...(extra === undefined ? {} : { extra }),
    };
    return {
      broadcastPayload: {
        clock: patch.clock,
        ...(extra === undefined ? {} : { extra }),
      },
      member,
    };
  },
  classify(envelope: PresenceEnvelope) {
    switch (envelope.type) {
      case TEST_PRESENCE_WIRE_TYPE.Auth:
        return PRESENCE_MESSAGE.Auth;
      case TEST_PRESENCE_WIRE_TYPE.Join:
        return PRESENCE_MESSAGE.Join;
      case TEST_PRESENCE_WIRE_TYPE.Leave:
        return PRESENCE_MESSAGE.Leave;
      case TEST_PRESENCE_WIRE_TYPE.Sync:
        return PRESENCE_MESSAGE.Sync;
      case TEST_PRESENCE_WIRE_TYPE.Heartbeat:
        return PRESENCE_MESSAGE.Heartbeat;
      case TEST_PRESENCE_WIRE_TYPE.Update:
        return PRESENCE_MESSAGE.Update;
      default:
        throw new Error(`unsupported presence wire type: ${envelope.type}`);
    }
  },
  consumeQuota(current, now) {
    const maximum = 80;
    const windowMs = 10_000;
    const state =
      isRecord(current) &&
      typeof current.count === "number" &&
      typeof current.windowStartedAt === "number"
        ? { count: current.count, windowStartedAt: current.windowStartedAt }
        : null;
    if (state === null || now - state.windowStartedAt >= windowMs) {
      return { allowed: true, state: { count: 1, windowStartedAt: now } };
    }
    if (state.count >= maximum) return { allowed: false, state };
    return {
      allowed: true,
      state: { count: state.count + 1, windowStartedAt: state.windowStartedAt },
    };
  },
  createMember(identity, connectionId) {
    return {
      clock: 0,
      connectionId,
      name: identity.name,
      userId: identity.userId,
    };
  },
  encode(kind, roomId, senderId, payload) {
    return { payload, roomId, senderId, type: kind };
  },
  isMember(value): value is PresenceMemberRecord {
    return (
      isRecord(value) &&
      typeof value.connectionId === "string" &&
      typeof value.userId === "string" &&
      typeof value.clock === "number"
    );
  },
  parseAuth(payload) {
    if (
      !isRecord(payload) ||
      typeof payload.connectionId !== "string" ||
      payload.connectionId.length === 0 ||
      typeof payload.userId !== "string" ||
      payload.userId.length === 0 ||
      payload.credential === undefined
    ) {
      throw new Error("invalid test presence auth payload");
    }
    return {
      connectionId: payload.connectionId,
      credential: payload.credential as CollabCredential,
      userId: payload.userId,
    };
  },
  parseEnvelope(value) {
    if (
      !isRecord(value) ||
      typeof value.type !== "string" ||
      value.type.length === 0 ||
      typeof value.roomId !== "string" ||
      value.roomId.length === 0 ||
      typeof value.senderId !== "string" ||
      value.senderId.length === 0
    ) {
      throw new Error("invalid test presence envelope");
    }
    return {
      roomId: value.roomId,
      senderId: value.senderId,
      type: value.type,
      ...(value.payload === undefined ? {} : { payload: value.payload }),
    };
  },
  parseHeartbeat(payload) {
    if (
      !isRecord(payload) ||
      typeof payload.pingId !== "string" ||
      payload.pingId.length === 0
    ) {
      throw new Error("invalid test presence heartbeat");
    }
    return payload.pingId;
  },
  parsePatch(payload) {
    if (
      !isRecord(payload) ||
      typeof payload.connectionId !== "string" ||
      typeof payload.userId !== "string" ||
      typeof payload.clock !== "number" ||
      !Number.isSafeInteger(payload.clock) ||
      payload.clock < 1
    ) {
      throw new Error("invalid test presence patch");
    }
    return {
      clock: payload.clock,
      connectionId: payload.connectionId,
      userId: payload.userId,
      ...(payload.extra === undefined ? {} : { extra: payload.extra }),
    } as PresencePatch & TestPatchPayload;
  },
});
