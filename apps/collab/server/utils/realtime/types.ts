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

export interface PresenceRoomStore {
  setUser(roomId: string, user: unknown, ttlMs: number): Promise<void>;
  refresh(
    roomId: string,
    connectionId: string,
    ttlMs: number,
  ): Promise<boolean>;
  getUser(roomId: string, connectionId: string): Promise<unknown | null>;
  listUsers(roomId: string): Promise<{
    readonly users: unknown[];
    readonly expiredConnectionIds: readonly string[];
  }>;
  removeUser(roomId: string, connectionId: string): Promise<unknown | null>;
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
