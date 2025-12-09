/**
 * Helper functions for tests
 */

import { Event, EventType } from '../types';

/**
 * Create an event with normalized parentVersion as Set
 */
export function createEvent(
  id: string,
  type: EventType | 'insert' | 'delete',
  position: number,
  parentVersion: string[] | Set<string>,
  content?: string,
  timestamp?: number
): Event {
  // Normalize type string to EventType enum
  const eventType = typeof type === 'string' 
    ? (type === 'insert' ? EventType.INSERT : EventType.DELETE)
    : type;

  return {
    id,
    type: eventType,
    position,
    parentVersion: parentVersion instanceof Set ? parentVersion : new Set(parentVersion),
    content,
    timestamp: timestamp ?? Date.now()
  };
}

/**
 * Normalize an existing event to ensure parentVersion is a Set
 */
export function normalizeEvent(event: any): Event {
  // Handle type normalization
  if (typeof event.type === 'string') {
    event.type = event.type === 'insert' ? EventType.INSERT : EventType.DELETE;
  }
  
  // Ensure parentVersion is a Set
  if (!(event.parentVersion instanceof Set)) {
    event.parentVersion = new Set(Array.isArray(event.parentVersion) ? event.parentVersion : []);
  }
  
  return event as Event;
}
