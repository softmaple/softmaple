/**
 * Pure functions for user presence operations
 */

import type { PresenceUser } from "../types/presence";
import { updatePresenceUser } from "../types/presence";
import type { PresenceState } from "../types/state";

/**
 * Add or update a user in state (pure function)
 */
export const setUser = (
  state: PresenceState,
  user: PresenceUser,
): PresenceState => {
  const newUsers = new Map(state.users);
  newUsers.set(user.userId, user);
  return { ...state, users: newUsers };
};

/**
 * Remove a user from state (pure function)
 */
export const removeUser = (
  state: PresenceState,
  userId: string,
): PresenceState => {
  if (!state.users.has(userId)) {
    return state;
  }
  const newUsers = new Map(state.users);
  newUsers.delete(userId);
  return { ...state, users: newUsers };
};

/**
 * Update a specific user's properties (pure function)
 */
export const updateUser = (
  state: PresenceState,
  userId: string,
  updates: Partial<Omit<PresenceUser, "userId">>,
): PresenceState => {
  const existingUser = state.users.get(userId);
  if (existingUser === undefined) {
    return state;
  }
  const updatedUser = updatePresenceUser(existingUser, updates);
  return setUser(state, updatedUser);
};

/**
 * Set the self user ID (pure function)
 */
export const setSelfId = (
  state: PresenceState,
  selfId: string | null,
): PresenceState => ({
  ...state,
  selfId,
});

/**
 * Batch update multiple users (pure function)
 */
export const setUsers = (
  state: PresenceState,
  users: ReadonlyArray<PresenceUser>,
): PresenceState => {
  const newUsers = new Map(state.users);
  for (const user of users) {
    newUsers.set(user.userId, user);
  }
  return { ...state, users: newUsers };
};

/**
 * Clear all users from state (pure function)
 */
export const clearUsers = (state: PresenceState): PresenceState => ({
  ...state,
  users: new Map(),
  selfId: null,
});
