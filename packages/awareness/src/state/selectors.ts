/**
 * Presence state selectors and factory helpers (pure functions).
 */

import type { PresenceUser } from "../types/presence";
import {
  DEFAULT_PRESENCE_CONFIG,
  type PresenceState,
  type PresenceStateConfig,
} from "../types/state";

export { DEFAULT_PRESENCE_CONFIG };
export type { PresenceStateConfig };

export const createInitialPresenceState = (): PresenceState => ({
  users: new Map(),
  activities: [],
  connectionStatus: "disconnected",
  selfId: null,
});

export const getUsersArray = (
  state: PresenceState,
): ReadonlyArray<PresenceUser> => Array.from(state.users.values());

export const getOnlineUsers = (
  state: PresenceState,
): ReadonlyArray<PresenceUser> =>
  getUsersArray(state).filter((user) => user.status !== "offline");

/** Look up a session by connectionId. */
export const getUserById = (
  state: PresenceState,
  connectionId: string,
): PresenceUser | undefined => state.users.get(connectionId);

/** All sessions belonging to a persistent userId. */
export const getSessionsByUserId = (
  state: PresenceState,
  userId: string,
): ReadonlyArray<PresenceUser> =>
  getUsersArray(state).filter((user) => user.userId === userId);

export const getSelfUser = (state: PresenceState): PresenceUser | undefined =>
  state.selfId ? state.users.get(state.selfId) : undefined;

export const getOtherUsers = (
  state: PresenceState,
): ReadonlyArray<PresenceUser> =>
  getUsersArray(state).filter((user) => user.connectionId !== state.selfId);
