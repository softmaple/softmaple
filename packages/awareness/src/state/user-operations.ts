/**
 * Pure functions for user presence operations
 */

import type { PresenceUser, PresenceUserPatch } from "../types/presence";
import { patchPresenceUser } from "../types/presence";
import type { PresenceState } from "../types/state";

/**
 * Add or update a session in state (pure function).
 * Keyed by connectionId.
 */
export const setUser = (
  state: PresenceState,
  user: PresenceUser,
): PresenceState => {
  const newUsers = new Map(state.users);
  newUsers.set(user.connectionId, user);
  return { ...state, users: newUsers };
};

/**
 * Remove a session from state by connectionId (pure function)
 */
export const removeUser = (
  state: PresenceState,
  connectionId: string,
): PresenceState => {
  if (!state.users.has(connectionId)) {
    return state;
  }
  const newUsers = new Map(state.users);
  newUsers.delete(connectionId);
  return { ...state, users: newUsers };
};

/**
 * Patch a specific session's properties without implying activity (pure)
 */
export const updateUser = (
  state: PresenceState,
  connectionId: string,
  updates: PresenceUserPatch,
): PresenceState => {
  const existingUser = state.users.get(connectionId);
  if (existingUser === undefined) {
    return state;
  }
  const updatedUser = patchPresenceUser(existingUser, updates);
  return setUser(state, updatedUser);
};

/**
 * Set the self connectionId (pure function)
 */
export const setSelfId = (
  state: PresenceState,
  selfId: string | null,
): PresenceState => ({
  ...state,
  selfId,
});

/**
 * Batch upsert multiple sessions (pure function)
 */
export const setUsers = (
  state: PresenceState,
  users: ReadonlyArray<PresenceUser>,
): PresenceState => {
  const newUsers = new Map(state.users);
  for (const user of users) {
    newUsers.set(user.connectionId, user);
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
