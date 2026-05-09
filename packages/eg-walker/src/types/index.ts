/**
 * Core type definitions for Eg-walker Section 3.1
 *
 * These types enforce the fundamental invariants:
 * - Strong list specification
 * - Index-based external operations
 * - Temporary internal CRDT state
 * - No persistent CRDT metadata
 */

import { OPERATION_TYPE } from "../constants/operation-types";
// ============================================================================
// External API Types (Index-based, no CRDT exposure)
// ============================================================================

/**
 * External operation types - always index-based
 * Never expose CRDT IDs or internal metadata
 */
export type ExternalOperation =
  | { type: typeof OPERATION_TYPE.INSERT; index: number; text: string }
  | { type: typeof OPERATION_TYPE.DELETE; index: number; length: number };

/**
 * Public document state - just plain text
 * No CRDT metadata should ever be exposed here
 */
export interface DocumentState {
  readonly text: string;
  readonly length: number;
}

// ============================================================================
// Event Graph Types (Persistent storage)
// ============================================================================

/**
 * Event ID uniquely identifies an operation in the graph
 * Format: "replicaId:sequenceNumber"
 */
export type EventId = string;

/**
 * Version is a set of event IDs representing causal dependencies
 */
export type Version = ReadonlySet<EventId>;

/**
 * Persistent event stored in the graph
 * This is what gets saved to disk - no CRDT metadata
 */
export interface GraphEvent {
  readonly id: EventId;
  readonly operation: ExternalOperation;
  readonly parentVersion: Version;
  readonly timestamp: number; // For tie-breaking only
}

export type SerializedVersion =
  | ReadonlyArray<EventId>
  | ReadonlySet<EventId>
  | Record<string, unknown>;

export interface SerializedGraphEvent {
  readonly id: EventId;
  readonly operation: ExternalOperation;
  readonly parentVersion: SerializedVersion;
  readonly timestamp: number;
}

// ============================================================================
// Invariant Types
// ============================================================================

/**
 * Invariant checker to ensure strong list specification
 */
export interface ListInvariant {
  /**
   * Verify that applying operations produces deterministic results
   */
  verify(events: ReadonlyArray<GraphEvent>): boolean;

  /**
   * Check that two states are equivalent
   */
  equivalent(state1: DocumentState, state2: DocumentState): boolean;
}

// ============================================================================
// Type Aliases
// ============================================================================

export type Event = GraphEvent;
export type SerializedGraph = {
  readonly version: SerializedVersion;
  readonly events: ReadonlyArray<SerializedGraphEvent>;
  readonly metadata?: Record<string, unknown>;
};
export type SerializedEventGraph = SerializedGraph;
