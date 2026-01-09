/**
 * useActivity hook - Access recent activity events
 */

import { useContext, useMemo } from "react";
import { PresenceContext } from "../providers/presence-context";
import type { ActivityEvent } from "../types/events";

const PROVIDER_ERROR_MSG =
  "must be used within a PresenceProvider. " +
  "Wrap your component tree with <PresenceProvider adapter={adapter}>.";

/**
 * Hook to access recent activity events
 * @returns Array of recent activity events (most recent first)
 * @throws Error if used outside of PresenceProvider
 */
export const useRecentActivity = (): ReadonlyArray<ActivityEvent> => {
  const context = useContext(PresenceContext);
  if (!context) {
    throw new Error(`useRecentActivity ${PROVIDER_ERROR_MSG}`);
  }
  return context.recentActivity;
};

/**
 * Hook to access activity events filtered by user
 * @param userId - User ID to filter by
 * @returns Array of activity events for the specified user
 * @throws Error if used outside of PresenceProvider
 */
export const useUserActivity = (
  userId: string,
): ReadonlyArray<ActivityEvent> => {
  const context = useContext(PresenceContext);
  if (!context) {
    throw new Error(`useUserActivity ${PROVIDER_ERROR_MSG}`);
  }
  return useMemo(
    () => context.recentActivity.filter((event) => event.userId === userId),
    [context.recentActivity, userId],
  );
};

/**
 * Hook to access activity events filtered by type
 * @param type - Activity type to filter by
 * @returns Array of activity events of the specified type
 * @throws Error if used outside of PresenceProvider
 */
export const useActivityByType = (
  type: ActivityEvent["type"],
): ReadonlyArray<ActivityEvent> => {
  const context = useContext(PresenceContext);
  if (!context) {
    throw new Error(`useActivityByType ${PROVIDER_ERROR_MSG}`);
  }
  return useMemo(
    () => context.recentActivity.filter((event) => event.type === type),
    [context.recentActivity, type],
  );
};
