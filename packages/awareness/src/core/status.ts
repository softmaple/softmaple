/**
 * Presence status derivation from activity vs liveness clocks.
 *
 * Status is a pure function of time and the two timestamps:
 *
 *   now - lastSeenAt > offlineTimeout  → offline
 *   now - lastActivityAt > idleTimeout → idle
 *   otherwise                          → active
 *
 * Heartbeats may only advance `lastSeenAt`. Real user actions advance
 * `lastActivityAt` (and usually `lastSeenAt` as well).
 */

import type { PresenceStatus, PresenceUser } from "../types/presence";
import { patchPresenceUser } from "../types/presence";
import {
  DEFAULT_PRESENCE_CONFIG,
  type PresenceStateConfig,
} from "../types/state";

export interface StatusTimeouts {
  readonly idleTimeoutMs: number;
  readonly offlineTimeoutMs: number;
}

/**
 * Derive presence status from lastSeenAt / lastActivityAt.
 */
export const derivePresenceStatus = (
  user: Pick<PresenceUser, "lastActivityAt" | "lastSeenAt">,
  config: StatusTimeouts = DEFAULT_PRESENCE_CONFIG,
  now: number = Date.now(),
): PresenceStatus => {
  if (now - user.lastSeenAt > config.offlineTimeoutMs) {
    return "offline";
  }
  if (now - user.lastActivityAt > config.idleTimeoutMs) {
    return "idle";
  }
  return "active";
};

/**
 * True when the peer's lastSeenAt is past the offline threshold.
 */
export const isUserOffline = (
  user: Pick<PresenceUser, "lastSeenAt">,
  offlineTimeoutMs: number,
  now: number = Date.now(),
): boolean => now - user.lastSeenAt > offlineTimeoutMs;

/**
 * True when the peer is still seen but past the idle threshold.
 * Callers that also care about offline should check `isUserOffline` first.
 */
export const isUserIdle = (
  user: Pick<PresenceUser, "lastActivityAt" | "lastSeenAt">,
  config: StatusTimeouts,
  now: number = Date.now(),
): boolean => derivePresenceStatus(user, config, now) === "idle";

/**
 * Recompute and store derived status on a user. Pure; returns the same
 * reference when status is unchanged.
 */
export const withDerivedStatus = (
  user: PresenceUser,
  config: StatusTimeouts = DEFAULT_PRESENCE_CONFIG,
  now: number = Date.now(),
): PresenceUser => {
  const status = derivePresenceStatus(user, config, now);
  return status === user.status ? user : patchPresenceUser(user, { status });
};

/**
 * Sweep a presence map, deriving statuses. Returns the same map reference
 * when nothing changed.
 */
export const sweepPresenceStatuses = (
  presence: ReadonlyMap<string, PresenceUser>,
  config: PresenceStateConfig | StatusTimeouts = DEFAULT_PRESENCE_CONFIG,
  now: number = Date.now(),
): {
  readonly presence: ReadonlyMap<string, PresenceUser>;
  readonly transitions: ReadonlyArray<PresenceUser>;
} => {
  let next: Map<string, PresenceUser> | null = null;
  const transitions: PresenceUser[] = [];

  for (const [connectionId, user] of presence) {
    const updated = withDerivedStatus(user, config, now);
    if (updated !== user) {
      if (next === null) next = new Map(presence);
      next.set(connectionId, updated);
      transitions.push(updated);
    }
  }

  return { presence: next ?? presence, transitions };
};
