/**
 * useOthers hook - Access other users' presence
 */

import { useContext, useMemo } from "react";
import { PresenceContext } from "../providers/presence-context";
import { applyResolver } from "../state/resolve-peer";
import type { PresenceUser } from "../types/presence";

const PROVIDER_ERROR_MSG =
  "must be used within a PresenceProvider. " +
  "Wrap your component tree with <PresenceProvider adapter={adapter}>.";

/**
 * Hook to access other users' presence (excluding self)
 * @returns Array of other users' presence
 * @throws Error if used outside of PresenceProvider
 */
export const useOthers = (): ReadonlyArray<PresenceUser> => {
  const context = useContext(PresenceContext);
  if (!context) {
    throw new Error(`useOthers ${PROVIDER_ERROR_MSG}`);
  }
  return context.others;
};

/**
 * Hook to get the count of other users
 * @returns Number of other users in the room
 * @throws Error if used outside of PresenceProvider
 */
export const useOthersCount = (): number => {
  const context = useContext(PresenceContext);
  if (!context) {
    throw new Error(`useOthersCount ${PROVIDER_ERROR_MSG}`);
  }
  return context.others.length;
};

/**
 * Hook to access a specific other user by ID
 * @param userId - The user ID to find
 * @returns The user's presence or undefined if not found
 * @throws Error if used outside of PresenceProvider
 */
export const useOther = (userId: string): PresenceUser | undefined => {
  const context = useContext(PresenceContext);
  if (!context) {
    throw new Error(`useOther ${PROVIDER_ERROR_MSG}`);
  }
  const { presence, self, resolver } = context;
  const selfId = self?.userId ?? null;

  return useMemo(() => {
    if (selfId !== null && userId === selfId) return undefined;
    const raw = presence.get(userId);
    return raw === undefined ? undefined : applyResolver(raw, resolver);
  }, [presence, userId, selfId, resolver]);
};

/**
 * Hook to access other users filtered by a predicate
 * @param predicate - Function to filter users
 * @returns Array of filtered users
 * @throws Error if used outside of PresenceProvider
 */
export const useOthersFiltered = (
  predicate: (user: PresenceUser) => boolean,
): ReadonlyArray<PresenceUser> => {
  const context = useContext(PresenceContext);
  if (!context) {
    throw new Error(`useOthersFiltered ${PROVIDER_ERROR_MSG}`);
  }
  return useMemo(
    () => context.others.filter(predicate),
    [context.others, predicate],
  );
};
