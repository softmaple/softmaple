import {
  presenceUserIdFromUnknown,
  requirePresenceConnectionId,
} from "./presence-user";
import type {
  ExpiredPresenceMember,
  PresenceRoomStore,
  PresenceUserRecord,
} from "./types";

interface PresenceEntry {
  user: unknown;
  expiresAt: number;
}

export class MemoryPresenceRoomStore implements PresenceRoomStore {
  private readonly rooms = new Map<string, Map<string, PresenceEntry>>();

  private purgeExpired(
    roomId: string,
    now: number,
  ): {
    readonly entries: Map<string, PresenceEntry>;
    readonly expired: ExpiredPresenceMember[];
  } {
    const entries = this.rooms.get(roomId) ?? new Map<string, PresenceEntry>();
    const expired: ExpiredPresenceMember[] = [];
    for (const [connectionId, entry] of entries) {
      if (entry.expiresAt <= now) {
        entries.delete(connectionId);
        expired.push({
          connectionId,
          userId: presenceUserIdFromUnknown(entry.user),
        });
      }
    }
    if (entries.size === 0) this.rooms.delete(roomId);
    else this.rooms.set(roomId, entries);
    return { entries, expired };
  }

  async setUser(
    roomId: string,
    user: PresenceUserRecord,
    ttlMs: number,
  ): Promise<void> {
    const connectionId = requirePresenceConnectionId(user);
    const now = Date.now();
    const { entries } = this.purgeExpired(roomId, now);
    entries.set(connectionId, { user, expiresAt: now + ttlMs });
    this.rooms.set(roomId, entries);
  }

  async refresh(
    roomId: string,
    connectionId: string,
    ttlMs: number,
  ): Promise<boolean> {
    const now = Date.now();
    const { entries } = this.purgeExpired(roomId, now);
    const current = entries.get(connectionId);
    if (current === undefined) return false;
    entries.set(connectionId, {
      user: current.user,
      expiresAt: now + ttlMs,
    });
    this.rooms.set(roomId, entries);
    return true;
  }

  async getUser(roomId: string, connectionId: string): Promise<unknown | null> {
    const now = Date.now();
    const { entries } = this.purgeExpired(roomId, now);
    return entries.get(connectionId)?.user ?? null;
  }

  async listUsers(roomId: string): Promise<{
    readonly users: unknown[];
    readonly expired: ReadonlyArray<ExpiredPresenceMember>;
  }> {
    const now = Date.now();
    const { entries, expired } = this.purgeExpired(roomId, now);
    return {
      users: [...entries.values()].map((entry) => entry.user),
      expired,
    };
  }

  async removeUser(roomId: string, connectionId: string): Promise<unknown> {
    const entries = this.rooms.get(roomId);
    if (entries === undefined) return null;
    const current = entries.get(connectionId)?.user ?? null;
    entries.delete(connectionId);
    if (entries.size === 0) this.rooms.delete(roomId);
    return current;
  }

  async close(): Promise<void> {
    this.rooms.clear();
  }
}
