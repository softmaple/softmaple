/**
 * Event manipulation utilities
 * Pure functions for event operations
 */

import { Event, EventType } from "../../types";
import { head } from "./array";

/**
 * Filter events by type
 */
export const filterEventsByType = (
  events: readonly Event[],
  type: EventType,
): Event[] => events.filter((event) => event.type === type);

/**
 * Group consecutive events by type and position
 */
export const groupConsecutiveEvents = (events: readonly Event[]): Event[][] => {
  if (events.length === 0) return [];

  const firstEvent = head(events);
  if (!firstEvent) return [];

  const groups: Event[][] = [];
  let currentGroup: Event[] = [firstEvent];

  for (let i = 1; i < events.length; i++) {
    const prev = events[i - 1];
    const curr = events[i];

    if (!prev || !curr) continue;

    if (prev.type === curr.type && prev.position === curr.position - 1) {
      currentGroup.push(curr);
    } else {
      groups.push([...currentGroup]);
      currentGroup = [curr];
    }
  }

  if (currentGroup.length > 0) {
    groups.push(currentGroup);
  }

  return groups;
};

/**
 * Check if an event is a deletion
 */
export const isDeletionEvent = (event: Event): boolean =>
  event.type === EventType.DELETE;

/**
 * Check if an event is an insertion
 */
export const isInsertionEvent = (event: Event): boolean =>
  event.type === EventType.INSERT;

/**
 * Extract content from an event safely
 */
export const getEventContent = (event: Event): string => event.content ?? "";

/**
 * Get event position safely
 */
export const getEventPosition = (event: Event): number => event.position;

/**
 * Create an immutable copy of an event with updated fields
 */
export const updateEvent = <K extends keyof Event>(
  event: Event,
  updates: Partial<Pick<Event, K>>,
): Event => ({ ...event, ...updates });

/**
 * Sort events by timestamp
 */
export const sortEventsByTimestamp = (events: readonly Event[]): Event[] =>
  [...events].sort((a, b) => {
    const aTime = a.timestamp ?? 0;
    const bTime = b.timestamp ?? 0;
    return aTime - bTime;
  });

/**
 * Sort events by dependencies
 */
export const sortEventsByDependencies = (events: readonly Event[]): Event[] =>
  [...events].sort((a, b) => {
    // Events with fewer dependencies come first
    const aDeps = a.parentVersion.size;
    const bDeps = b.parentVersion.size;
    if (aDeps !== bDeps) return aDeps - bDeps;

    // Then sort by timestamp
    const aTime = a.timestamp ?? 0;
    const bTime = b.timestamp ?? 0;
    if (aTime !== bTime) return aTime - bTime;

    // Finally by ID for stability
    return a.id.localeCompare(b.id);
  });

/**
 * Get insertions from events
 */
export const getInsertions = (events: readonly Event[]): Event[] =>
  filterEventsByType(events, EventType.INSERT);

/**
 * Get deletions from events
 */
export const getDeletions = (events: readonly Event[]): Event[] =>
  filterEventsByType(events, EventType.DELETE);
