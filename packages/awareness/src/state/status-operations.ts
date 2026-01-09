/**
 * Pure functions for user status management (active/idle/offline)
 */

import type { PresenceStatus, PresenceUser } from "../types/presence";
import { updatePresenceUser } from "../types/presence";
import type { PresenceState, PresenceStateConfig } from "../types/state";
import { DEFAULT_PRESENCE_CONFIG } from "../types/state";

/**
 * Determine user status based on last activity time (pure function)
 */
export const determineUserStatus = (
  user: PresenceUser,
  config: PresenceStateConfig = DEFAULT_PRESENCE_CONFIG,
): PresenceStatus => {
  const now = Date.now();
  const elapsed = now - user.lastActiveAt;

  if (elapsed > config.offlineTimeoutMs) {
    return "offline";
  }
  if (elapsed > config.idleTimeoutMs) {
    return "idle";
  }
  return "active";
};

/**
 * Update all users' statuses based on their last activity (pure function)
 */
export const updateAllUserStatuses = (
  state: PresenceState,
  config: PresenceStateConfig = DEFAULT_PRESENCE_CONFIG,
): PresenceState => {
  let hasChanges = false;
  const newUsers = new Map<string, PresenceUser>();

  for (const [userId, user] of state.users) {
    const newStatus = determineUserStatus(user, config);
    if (newStatus !== user.status) {
      hasChanges = true;
      newUsers.set(userId, updatePresenceUser(user, { status: newStatus }));
    } else {
      newUsers.set(userId, user);
    }
  }

  return hasChanges ? { ...state, users: newUsers } : state;
};

/**
 * Remove offline users from state (pure function)
 */
export const removeOfflineUsers = (state: PresenceState): PresenceState => {
  const onlineUsers = new Map<string, PresenceUser>();

  for (const [userId, user] of state.users) {
    if (user.status !== "offline") {
      onlineUsers.set(userId, user);
    }
  }

  if (onlineUsers.size === state.users.size) {
    return state;
  }

  return { ...state, users: onlineUsers };
};

/**
 * Mark a user as active (pure function)
 */
export const markUserActive = (
  state: PresenceState,
  userId: string,
): PresenceState => {
  const user = state.users.get(userId);
  if (user === undefined) {
    return state;
  }

  const updatedUser = updatePresenceUser(user, {
    status: "active",
    lastActiveAt: Date.now(),
  });

  const newUsers = new Map(state.users);
  newUsers.set(userId, updatedUser);

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
