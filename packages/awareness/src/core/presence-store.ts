/**
 * Presence session store — single authority for presence Map / status / clock.
 *
 * Transport adapters feed events in; React providers subscribe out.
 * Adapters must not independently demote users to idle/offline.
 */

import {
  applyClockedPresenceUpdate,
  type CreatePresenceUserOptions,
  createPresenceUser,
  markUserActivity,
  type PresenceUser,
  type PresenceUserPatch,
  touchUserSeen,
} from "../types/presence";
import {
  DEFAULT_PRESENCE_CONFIG,
  type PresenceStateConfig,
} from "../types/state";
import { type StatusTimeouts, sweepPresenceStatuses } from "./status";

export type PresenceStoreListener = (
  presence: ReadonlyMap<string, PresenceUser>,
) => void;

export interface PresenceStoreOptions {
  readonly timeouts?: StatusTimeouts;
}

export interface PresenceStore {
  /** Current sessions keyed by connectionId */
  getPresence(): ReadonlyMap<string, PresenceUser>;
  getSession(connectionId: string): PresenceUser | undefined;
  getSelf(): PresenceUser | null;
  setSelf(user: PresenceUser | null): void;

  /** Insert or replace a full session snapshot (join / sync). */
  upsertSession(user: PresenceUser): PresenceUser;
  /** Remove a session by connectionId. */
  removeSession(connectionId: string): boolean;

  /**
   * Apply a remote clocked update. Stale clocks still refresh lastSeenAt.
   * Returns the resulting user (or null if the session is unknown).
   */
  applyRemoteUpdate(
    connectionId: string,
    clock: number,
    updates: PresenceUserPatch & {
      readonly lastActivityAt?: number;
      readonly lastSeenAt?: number;
    },
    seenAt?: number,
  ): PresenceUser | null;

  /** Local activity that bumps clock + lastActivityAt. */
  markActivity(
    connectionId: string,
    extras?: PresenceUserPatch,
    at?: number,
  ): PresenceUser | null;

  /** Heartbeat / transport liveness — lastSeenAt only. */
  touchSeen(connectionId: string, at?: number): PresenceUser | null;

  /** Derive statuses for all sessions; notify on change. */
  sweepStatuses(now?: number): ReadonlyArray<PresenceUser>;

  /** Replace entire presence map (e.g. sync response), preserving self. */
  replaceAll(users: ReadonlyArray<PresenceUser>): void;

  subscribe(listener: PresenceStoreListener): () => void;
}

/**
 * Create an in-memory presence store keyed by connectionId.
 */
export const createPresenceStore = (
  options: PresenceStoreOptions = {},
): PresenceStore => {
  const timeouts = options.timeouts ?? DEFAULT_PRESENCE_CONFIG;
  let presence = new Map<string, PresenceUser>();
  let self: PresenceUser | null = null;
  const listeners = new Set<PresenceStoreListener>();

  const notify = (): void => {
    const snapshot = new Map(presence);
    for (const listener of listeners) {
      listener(snapshot);
    }
  };

  const put = (user: PresenceUser): PresenceUser => {
    presence = new Map(presence).set(user.connectionId, user);
    if (self !== null && self.connectionId === user.connectionId) {
      self = user;
    }
    notify();
    return user;
  };

  return {
    getPresence: () => new Map(presence),

    getSession: (connectionId) => presence.get(connectionId),

    getSelf: () => self,

    setSelf: (user) => {
      self = user;
      if (user !== null) {
        presence = new Map(presence).set(user.connectionId, user);
      }
      notify();
    },

    upsertSession: (user) => put(user),

    removeSession: (connectionId) => {
      if (!presence.has(connectionId)) return false;
      const next = new Map(presence);
      next.delete(connectionId);
      presence = next;
      if (self?.connectionId === connectionId) {
        self = null;
      }
      notify();
      return true;
    },

    applyRemoteUpdate: (connectionId, clock, updates, seenAt = Date.now()) => {
      const existing = presence.get(connectionId);
      if (existing === undefined) return null;
      const applied = applyClockedPresenceUpdate(
        existing,
        clock,
        updates,
        seenAt,
      );
      // applyClockedPresenceUpdate always returns a user (stale → touchSeen)
      return put(applied);
    },

    markActivity: (connectionId, extras, at = Date.now()) => {
      const existing = presence.get(connectionId);
      if (existing === undefined) return null;
      return put(markUserActivity(existing, at, extras));
    },

    touchSeen: (connectionId, at = Date.now()) => {
      const existing = presence.get(connectionId);
      if (existing === undefined) return null;
      return put(touchUserSeen(existing, at));
    },

    sweepStatuses: (now = Date.now()) => {
      const { presence: swept, transitions } = sweepPresenceStatuses(
        presence,
        timeouts,
        now,
      );
      if (swept !== presence) {
        presence = new Map(swept);
        if (self !== null) {
          const updated = presence.get(self.connectionId);
          if (updated !== undefined) self = updated;
        }
        notify();
      }
      return transitions;
    },

    replaceAll: (users) => {
      const next = new Map<string, PresenceUser>();
      for (const user of users) {
        next.set(user.connectionId, user);
      }
      if (self !== null) {
        next.set(self.connectionId, self);
      }
      presence = next;
      notify();
    },

    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};

/**
 * Convenience: build a local self session from adapter user info.
 */
export const createSelfSession = (
  options: CreatePresenceUserOptions,
): PresenceUser => createPresenceUser(options);

export type { PresenceStateConfig, StatusTimeouts };
