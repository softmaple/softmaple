/**
 * Pure functions for user status management (active/idle/offline)
 */

import { derivePresenceStatus, withDerivedStatus } from "../core/status";
import type { PresenceStatus, PresenceUser } from "../types/presence";
import { markUserActivity, patchPresenceUser } from "../types/presence";
import type { PresenceState, PresenceStateConfig } from "../types/state";
import { DEFAULT_PRESENCE_CONFIG } from "./selectors";

/**
 * Determine user status from lastSeenAt / lastActivityAt (pure function)
 */
export const determineUserStatus = (
  user: PresenceUser,
  config: PresenceStateConfig = DEFAULT_PRESENCE_CONFIG,
  now: number = Date.now(),
): PresenceStatus => derivePresenceStatus(user, config, now);

/**
 * Update all users' statuses based on activity vs liveness clocks (pure)
 */
export const updateAllUserStatuses = (
  state: PresenceState,
  config: PresenceStateConfig = DEFAULT_PRESENCE_CONFIG,
  now: number = Date.now(),
): PresenceState => {
  let hasChanges = false;
  const newUsers = new Map<string, PresenceUser>();

  for (const [connectionId, user] of state.users) {
    const updated = withDerivedStatus(user, config, now);
    if (updated !== user) {
      hasChanges = true;
    }
    newUsers.set(connectionId, updated);
  }

  return hasChanges ? { ...state, users: newUsers } : state;
};

/**
 * Remove offline users from state (pure function)
 */
export const removeOfflineUsers = (state: PresenceState): PresenceState => {
  const onlineUsers = new Map<string, PresenceUser>();

  for (const [connectionId, user] of state.users) {
    if (user.status !== "offline") {
      onlineUsers.set(connectionId, user);
    }
  }

  if (onlineUsers.size === state.users.size) {
    return state;
  }

  return { ...state, users: onlineUsers };
};

/**
 * Mark a user as active via the activity API (pure function)
 */
export const markUserActive = (
  state: PresenceState,
  connectionId: string,
  at: number = Date.now(),
): PresenceState => {
  const user = state.users.get(connectionId);
  if (user === undefined) {
    return state;
  }

  const updatedUser = markUserActivity(user, at);
  const newUsers = new Map(state.users);
  newUsers.set(connectionId, updatedUser);

  return { ...state, users: newUsers };
};

/**
 * Patch status without touching timestamps (for tests / explicit overrides)
 */
export const setUserStatus = (
  state: PresenceState,
  connectionId: string,
  status: PresenceStatus,
): PresenceState => {
  const user = state.users.get(connectionId);
  if (user === undefined) {
    return state;
  }
  const newUsers = new Map(state.users);
  newUsers.set(connectionId, patchPresenceUser(user, { status }));
  return { ...state, users: newUsers };
};

/**
 * Get users by status (pure function)
 */
export const getUsersByStatus = (
  state: PresenceState,
  status: PresenceStatus,
): ReadonlyArray<PresenceUser> =>
  Array.from(state.users.values()).filter((user) => user.status === status);

/**
 * Count users by status (pure function)
 */
export const countUsersByStatus = (
  state: PresenceState,
): Record<PresenceStatus, number> => {
  const counts: Record<PresenceStatus, number> = {
    active: 0,
    idle: 0,
    offline: 0,
  };

  for (const user of state.users.values()) {
    counts[user.status]++;
  }

  return counts;
};
