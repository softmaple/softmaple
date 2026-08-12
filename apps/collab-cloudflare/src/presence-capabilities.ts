import {
  CONNECTION_REJECTION_REASON,
  type ConnectionLimiter,
  type ExpiredPresenceMember,
  type PresenceBroadcast,
  type PresenceFanout,
  type PresenceFanoutHandler,
  type PresenceMemberRecord,
  type PresenceStore,
} from "@softmaple/collab-runtime";

/**
 * DO-local presence capabilities. Deliberately independent from
 * `do-capabilities.ts`: `PresenceRoomDO` must share no capability instance
 * with `DocumentRoomDO` (see docs/design/collaboration-runtime.md), so
 * these are not imported from — or shared with — the document object.
 */
export const createDurableObjectPresenceConnectionLimiter =
  (): ConnectionLimiter => {
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

export const createDurableObjectPresenceFanout = (): PresenceFanout => {
  const handlers = new Map<string, Set<PresenceFanoutHandler>>();

  return {
    async publish(broadcast: PresenceBroadcast) {
      const current = [...(handlers.get(broadcast.roomId) ?? [])];
      await Promise.allSettled(current.map((handler) => handler(broadcast)));
    },

    async subscribe(roomId, handler) {
      const current = handlers.get(roomId) ?? new Set<PresenceFanoutHandler>();
      current.add(handler);
      handlers.set(roomId, current);
      let subscribed = true;
      return {
        async unsubscribe() {
          if (!subscribed) return;
          subscribed = false;
          const active = handlers.get(roomId);
          active?.delete(handler);
          if (active?.size === 0) handlers.delete(roomId);
        },
      };
    },
  };
};

interface StoredPresenceMember {
  readonly expiresAt: number;
  readonly member: PresenceMemberRecord;
}

const memberKey = (roomId: string, connectionId: string): string =>
  `presence:${roomId}:member:${connectionId}`;

const memberPrefix = (roomId: string): string => `presence:${roomId}:member:`;

/**
 * `ctx.storage`-backed presence membership, so members survive Durable
 * Object hibernation/eviction. Storage has no native per-key TTL, so
 * expiry is tracked alongside each record and purged lazily on read,
 * matching every other `PresenceStore` implementation's contract.
 */
export const createDurableObjectPresenceStore = (
  storage: DurableObjectStorage,
): PresenceStore => ({
  async getMember(roomId, connectionId) {
    const stored = await storage.get<StoredPresenceMember>(
      memberKey(roomId, connectionId),
    );
    if (stored === undefined) return null;
    if (stored.expiresAt <= Date.now()) {
      await storage.delete(memberKey(roomId, connectionId));
      return null;
    }
    return stored.member;
  },

  async listMembers(roomId) {
    const stored = await storage.list<StoredPresenceMember>({
      prefix: memberPrefix(roomId),
    });
    const now = Date.now();
    const members: unknown[] = [];
    const expired: ExpiredPresenceMember[] = [];
    const expiredKeys: string[] = [];
    for (const [key, entry] of stored) {
      if (entry.expiresAt <= now) {
        expiredKeys.push(key);
        expired.push({
          connectionId: entry.member.connectionId,
          userId: entry.member.userId,
        });
        continue;
      }
      members.push(entry.member);
    }
    if (expiredKeys.length > 0) await storage.delete(expiredKeys);
    return { expired, members };
  },

  async refreshMember(roomId, connectionId, ttlMs) {
    const key = memberKey(roomId, connectionId);
    const stored = await storage.get<StoredPresenceMember>(key);
    if (stored === undefined) return false;
    const now = Date.now();
    if (stored.expiresAt <= now) {
      await storage.delete(key);
      return false;
    }
    await storage.put(key, { expiresAt: now + ttlMs, member: stored.member });
    return true;
  },

  async removeMember(roomId, connectionId) {
    const key = memberKey(roomId, connectionId);
    const stored = await storage.get<StoredPresenceMember>(key);
    if (stored === undefined) return null;
    await storage.delete(key);
    return stored.expiresAt > Date.now() ? stored.member : null;
  },

  async setMember(roomId, member, ttlMs) {
    await storage.put(memberKey(roomId, member.connectionId), {
      expiresAt: Date.now() + ttlMs,
      member,
    });
  },
});
