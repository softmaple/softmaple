/**
 * Pure functions for activity event operations
 */

import type { ActivityEvent, ActivityType } from "../types/events";
import { createActivityEvent } from "../types/events";
import type { PresenceState, PresenceStateConfig } from "../types/state";
import { DEFAULT_PRESENCE_CONFIG } from "../types/state";

/**
 * Add an activity event to state (pure function)
 * Maintains bounded list, removing oldest when exceeding max
 */
export const addActivity = (
  state: PresenceState,
  activity: ActivityEvent,
  config: PresenceStateConfig = DEFAULT_PRESENCE_CONFIG,
): PresenceState => {
  const newActivities = [...state.activities, activity];

  if (newActivities.length > config.maxActivities) {
    return {
      ...state,
      activities: newActivities.slice(-config.maxActivities),
    };
  }

  return { ...state, activities: newActivities };
};

/**
 * Create and add an activity event (pure function)
 */
export const recordActivity = (
  state: PresenceState,
  userId: string,
  type: ActivityType,
  config: PresenceStateConfig = DEFAULT_PRESENCE_CONFIG,
): PresenceState => {
  const activity = createActivityEvent(userId, type);
  return addActivity(state, activity, config);
};

/**
 * Get activities for a specific user (pure function)
 */
export const getActivitiesForUser = (
  state: PresenceState,
  userId: string,
): ReadonlyArray<ActivityEvent> =>
  state.activities.filter((activity) => activity.userId === userId);

/**
 * Get activities of a specific type (pure function)
 */
export const getActivitiesByType = (
  state: PresenceState,
  type: ActivityType,
): ReadonlyArray<ActivityEvent> =>
  state.activities.filter((activity) => activity.type === type);

/**
 * Get recent activities within a time window (pure function)
 */
export const getRecentActivities = (
  state: PresenceState,
  windowMs: number,
): ReadonlyArray<ActivityEvent> => {
  const cutoff = Date.now() - windowMs;
  return state.activities.filter((activity) => activity.timestamp >= cutoff);
};

/**
 * Clear all activities (pure function)
 */
export const clearActivities = (state: PresenceState): PresenceState => ({
  ...state,
  activities: [],
});

/**
 * Get the most recent activity for each user (pure function)
 */
export const getLatestActivityPerUser = (
  state: PresenceState,
): ReadonlyMap<string, ActivityEvent> => {
  const latestByUser = new Map<string, ActivityEvent>();

  for (const activity of state.activities) {
    const existing = latestByUser.get(activity.userId);
    if (existing === undefined || activity.timestamp > existing.timestamp) {
      latestByUser.set(activity.userId, activity);
    }
  }

  return latestByUser;
};
