/**
 * Core types for the Eg-walker algorithm
 */

/** Unique identifier for an event */
export type EventId = string;

/** Position in the document */
export type Position = number;

/** Version represented as a frontier of event IDs */
export type Version = Set<EventId>;

/** Prepare state values for CRDT items */
export enum PrepareState {
  NOT_YET_INSERTED = 0,
  INSERTED = 1,
  // Any value >= 2 means deleted (n-1) times
}

/** Event types */
export enum EventType {
  INSERT = 'insert',
  DELETE = 'delete',
}

/** An event in the document history */
export interface Event {
  id: EventId;
  type: EventType;
  parentVersion: Version;
  position: Position;
  content?: string; // For insert events
  timestamp?: number;
}

/** Augmented CRDT item with prepare/effect states */
export interface AugmentedCRDTItem {
  // CRDT fields for determining insertion order
  id: EventId;
  originLeft: EventId | null;
  originRight: EventId | null;
  content?: string;
  
  // State at effect version (what user sees)
  everDeleted: boolean;
  
  // State at prepare version (for positioning)
  prepareState: number;
}

/** Helper functions for CRDT items */
export function spaceInPrepareState(item: AugmentedCRDTItem): number {
  return item.prepareState === PrepareState.INSERTED ? 1 : 0;
}

export function spaceInEffectState(item: AugmentedCRDTItem): number {
  return !item.everDeleted ? 1 : 0;
}
