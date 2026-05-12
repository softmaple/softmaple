/**
 * Presence state selectors and factory helpers (pure functions).
 */

import type { PresenceUser } from "../types/presence";
import type { PresenceState, PresenceStateConfig } from "../types/state";

export const DEFAULT_PRESENCE_CONFIG: PresenceStateConfig = {
  maxActivities: 100,
  idleTimeoutMs: 60_000,
  offlineTimeoutMs: 120_000,
  cursorThrottleMs: 50,
} as const;

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

export const getUserById = (
  state: PresenceState,
  userId: string,
): PresenceUser | undefined => state.users.get(userId);

export const getSelfUser = (state: PresenceState): PresenceUser | undefined =>
  state.selfId ? state.users.get(state.selfId) : undefined;

export const getOtherUsers = (
  state: PresenceState,
): ReadonlyArray<PresenceUser> =>
  getUsersArray(state).filter((user) => user.userId !== state.selfId);
