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

// ============================================================================
// Internal CRDT Types (Temporary, never persisted)
// ============================================================================

/**
 * Internal CRDT item - exists only during transformations
 * Must be destroyed when no longer needed
 */
export interface CRDTItem {
  readonly id: EventId;
  readonly content: string; // Single character or run
  readonly originLeft: EventId | null; // For RGA ordering
  readonly originRight: EventId | null;
  readonly isDeleted: boolean;
  readonly insertedBy: EventId; // Track which event created this
}

/**
 * Prepare state - intermediate CRDT state during retreat
 */
export interface PrepareState {
  readonly items: ReadonlyArray<CRDTItem>;
  readonly visibleIndices: ReadonlyMap<EventId, number>;
}

/**
 * Effect state - final CRDT state after advance
 */
export interface EffectState {
  readonly items: ReadonlyArray<CRDTItem>;
  readonly visibleText: string;
}

// ============================================================================
// Invariant Types
// ============================================================================

/**
 * Ordering rule for concurrent insertions
 * Enforces maximally non-interleaving behavior
 */
export interface OrderingRule {
  /**
   * Compare two concurrent insertions to determine order
   * Returns true if a should come before b
   */
  compare(a: CRDTItem, b: CRDTItem): boolean;
}

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
// Configuration Types
// ============================================================================

/**
 * Configuration for non-interleaving behavior
 */
export interface NonInterleavingConfig {
  /**
   * Minimum run length to preserve as a block
   */
  readonly minRunLength: number;

  /**
   * Strategy for tie-breaking concurrent runs
   */
  readonly tieBreaker: "timestamp" | "replica-id" | "lexicographic";
}

/**
 * Runtime constraints for Section 3.1
 */
export interface EgWalkerConstraints {
  readonly maxCRDTLifetime: number; // Max ms CRDT can exist
  readonly requireCleanup: boolean; // Enforce CRDT cleanup
  readonly strictNonInterleaving: boolean; // Enforce run grouping
}

// ============================================================================
// Type Aliases for Compatibility
// ============================================================================

export type Event = GraphEvent;
export type SerializedGraph = {
  readonly version: Version;
  readonly events: ReadonlyArray<GraphEvent>;
  readonly metadata?: Record<string, unknown>;
};
export type SerializedEventGraph = SerializedGraph;
