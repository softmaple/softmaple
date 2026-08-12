/** A member the room removed because its TTL lapsed on a read. */
export interface ExpiredPresenceMember {
  readonly connectionId: string;
  readonly userId: string;
}

/**
 * Room-owned identity fields on a stored presence member. Every other field
 * (cursor, selection, name, color, activity/liveness timestamps, `meta`) is
 * codec-owned payload the store never inspects; awareness's `PresenceUser`
 * is structurally assignable to this.
 */
export interface PresenceMemberRecord {
  readonly clock: number;
  readonly connectionId: string;
  readonly userId: string;
}

/**
 * A store read purges lapsed members as a side effect. `expired` reports
 * exactly the members removed by that read so the room can fan out one
 * Leave per lapsed member; `members` are opaque records the room validates
 * with `PresenceCodec.isMember`.
 */
export interface PresenceMemberPage {
  readonly expired: ReadonlyArray<ExpiredPresenceMember>;
  readonly members: ReadonlyArray<unknown>;
}

/**
 * TTL-backed presence membership for one room. Implementations purge lapsed
 * members lazily on read; there is no separate expiry callback. Same-room
 * calls do not need to serialize with each other beyond what each method
 * individually guarantees.
 */
export interface PresenceStore {
  /** Returns null when absent or lapsed. */
  getMember(roomId: string, connectionId: string): Promise<unknown | null>;
  listMembers(roomId: string): Promise<PresenceMemberPage>;
  /** False when the member is absent or already lapsed. */
  refreshMember(
    roomId: string,
    connectionId: string,
    ttlMs: number,
  ): Promise<boolean>;
  /** Returns the removed record, or null when nothing was stored. */
  removeMember(roomId: string, connectionId: string): Promise<unknown>;
  setMember(
    roomId: string,
    member: PresenceMemberRecord,
    ttlMs: number,
  ): Promise<void>;
}
