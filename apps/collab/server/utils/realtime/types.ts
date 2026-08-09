export type RealtimeHandler = (payload: unknown) => void | Promise<void>;

export interface RealtimeBus {
  publish(channel: string, payload: unknown): Promise<void>;
  subscribe(
    channel: string,
    handler: RealtimeHandler,
  ): Promise<() => Promise<void>>;
  close(): Promise<void>;
}

export const LeaseAcquireResult = {
  Acquired: "acquired",
  Full: "full",
  Duplicate: "duplicate",
} as const;

export type LeaseAcquireResult =
  (typeof LeaseAcquireResult)[keyof typeof LeaseAcquireResult];

export interface ConnectionLeaseStore {
  tryAcquire(
    scope: string,
    connectionId: string,
    maxConnections: number,
    ttlMs: number,
  ): Promise<LeaseAcquireResult>;
  refresh(scope: string, connectionId: string, ttlMs: number): Promise<boolean>;
  release(scope: string, connectionId: string): Promise<void>;
  close(): Promise<void>;
}

/** Minimal presence payload; adapters require `connectionId` and accept extra fields. */
export type PresenceUserRecord = {
  readonly connectionId: string;
};

export interface ExpiredPresenceMember {
  readonly connectionId: string;
  readonly userId: string;
}

export interface PresenceRoomStore {
  setUser(
    roomId: string,
    user: PresenceUserRecord,
    ttlMs: number,
  ): Promise<void>;
  refresh(
    roomId: string,
    connectionId: string,
    ttlMs: number,
  ): Promise<boolean>;
  getUser(roomId: string, connectionId: string): Promise<unknown | null>;
  listUsers(roomId: string): Promise<{
    readonly users: unknown[];
    readonly expired: ReadonlyArray<ExpiredPresenceMember>;
  }>;
  removeUser(roomId: string, connectionId: string): Promise<unknown>;
  close(): Promise<void>;
}

export interface CollabRealtime {
  readonly bus: RealtimeBus;
  readonly leases: ConnectionLeaseStore;
  readonly presence: PresenceRoomStore;
  close(): Promise<void>;
}

export interface RealtimePeer {
  send(payload: unknown): void;
}
