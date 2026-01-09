/**
 * Immutable state management for presence adapters
 */

import type { PresenceUser } from "../types/presence";
import type { AdapterConnectionState } from "./types";

/**
 * Immutable state container for adapters
 */
export interface AdapterState {
  readonly connectionState: AdapterConnectionState;
  readonly presence: ReadonlyMap<string, PresenceUser>;
  readonly self: PresenceUser | null;
}

/**
 * Create initial adapter state
 */
export const createInitialState = (): AdapterState => ({
  connectionState: "disconnected",
  presence: new Map(),
  self: null,
});

/**
 * Update state immutably
 */
export const updateState = (
  state: AdapterState,
  updates: Partial<AdapterState>,
): AdapterState => ({
  ...state,
  ...updates,
});

/**
 * Add or update user in presence map immutably
 */
export const setPresenceUser = (
  presence: ReadonlyMap<string, PresenceUser>,
  user: PresenceUser,
): ReadonlyMap<string, PresenceUser> => {
  const newMap = new Map(presence);
  newMap.set(user.userId, user);
  return newMap;
};

/**
 * Remove user from presence map immutably
 */
export const removePresenceUser = (
  presence: ReadonlyMap<string, PresenceUser>,
  userId: string,
): ReadonlyMap<string, PresenceUser> => {
  const newMap = new Map(presence);
  newMap.delete(userId);
  return newMap;
};

/**
 * Check if user should be considered offline based on last activity
 */
export const isUserOffline = (user: PresenceUser, timeoutMs: number): boolean =>
  Date.now() - user.lastActiveAt > timeoutMs;

/**
 * Check if user should be considered idle
 */
export const isUserIdle = (
  user: PresenceUser,
  idleTimeoutMs: number,
): boolean => Date.now() - user.lastActiveAt > idleTimeoutMs;
