/**
 * Immutable state management for presence adapters
 */

import type { PresenceUser } from "../types/presence";
import type { AdapterConnectionState } from "./types";

/**
 * Immutable state container for adapters
 *
 * `presence` is keyed by `connectionId`.
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
 * Add or update session in presence map immutably (keyed by connectionId)
 */
export const setPresenceUser = (
  presence: ReadonlyMap<string, PresenceUser>,
  user: PresenceUser,
): ReadonlyMap<string, PresenceUser> => {
  const newMap = new Map(presence);
  newMap.set(user.connectionId, user);
  return newMap;
};

/**
 * Remove session from presence map by connectionId
 */
export const removePresenceUser = (
  presence: ReadonlyMap<string, PresenceUser>,
  connectionId: string,
): ReadonlyMap<string, PresenceUser> => {
  const newMap = new Map(presence);
  newMap.delete(connectionId);
  return newMap;
};

export {
  isUserIdle,
  isUserOffline,
} from "../core/status";
