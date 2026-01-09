/**
 * useOthers hook - Access other users' presence
 */

import { useContext, useMemo } from "react";
import { PresenceContext } from "../providers/presence-context";
import type { PresenceUser } from "../types/presence";

/**
 * Hook to access other users' presence (excluding self)
 * @returns Array of other users' presence
 */
export const useOthers = (): ReadonlyArray<PresenceUser> => {
  const { others } = useContext(PresenceContext);
  return others;
};

/**
 * Hook to get the count of other users
 * @returns Number of other users in the room
 */
export const useOthersCount = (): number => {
  const { others } = useContext(PresenceContext);
  return others.length;
};

/**
 * Hook to access a specific other user by ID
 * @param userId - The user ID to find
 * @returns The user's presence or undefined if not found
 */
export const useOther = (userId: string): PresenceUser | undefined => {
  const { presence, self } = useContext(PresenceContext);
  if (self !== null && userId === self.userId) return undefined;
  return presence.get(userId);
};

/**
 * Hook to access other users filtered by a predicate
 * @param predicate - Function to filter users
 * @returns Array of filtered users
 */
export const useOthersFiltered = (
  predicate: (user: PresenceUser) => boolean,
): ReadonlyArray<PresenceUser> => {
  const { others } = useContext(PresenceContext);
  return useMemo(() => others.filter(predicate), [others, predicate]);
};
