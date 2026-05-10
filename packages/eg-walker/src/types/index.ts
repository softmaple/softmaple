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

/**
 * Serialized version output: the shape produced by `EventGraph.serialize()`
 * and the columnar codec. Always a JSON-safe array of event IDs.
 */
export type SerializedVersionOutput = ReadonlyArray<EventId>;

/**
 * Serialized version input: tolerant shape accepted by `EventGraph.deserialize()`.
 * Covers the JSON-safe array form, in-memory `Set` instances, generic
 * iterables, and (defensively) plain objects produced by accidentally
 * `JSON.stringify`ing a `Set` from older code.
 */
export type SerializedVersionInput =
  | ReadonlyArray<EventId>
  | ReadonlySet<EventId>
  | Iterable<EventId>
  | Record<string, unknown>;

/**
 * @deprecated Use {@link SerializedVersionOutput} for serialize results and
 * {@link SerializedVersionInput} for deserialize inputs.
 */
export type SerializedVersion = SerializedVersionInput;

export interface SerializedGraphEventOutput {
  readonly id: EventId;
  readonly operation: ExternalOperation;
  readonly parentVersion: SerializedVersionOutput;
  readonly timestamp: number;
}

export interface SerializedGraphEventInput {
  readonly id: EventId;
  readonly operation: ExternalOperation;
  readonly parentVersion: SerializedVersionInput;
  readonly timestamp: number;
}

/** @deprecated Use {@link SerializedGraphEventInput}. */
export type SerializedGraphEvent = SerializedGraphEventInput;

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

/**
 * Shape produced by {@link EventGraph.serialize} — always JSON-safe.
 */
export interface SerializedGraphOutput {
  readonly version: SerializedVersionOutput;
  readonly events: ReadonlyArray<SerializedGraphEventOutput>;
  readonly metadata?: Record<string, unknown>;
}

/**
 * Shape accepted by {@link EventGraph.deserialize}. Tolerates both the
 * JSON-safe output shape and in-memory `Set` instances.
 */
export interface SerializedGraphInput {
  readonly version: SerializedVersionInput;
  readonly events: ReadonlyArray<SerializedGraphEventInput>;
  readonly metadata?: Record<string, unknown>;
}

/**
 * Combined serialize/deserialize type. `serialize()` returns the narrow output
 * shape; `deserialize()` accepts the wider input shape.
 */
export type SerializedGraph = SerializedGraphInput;
export type SerializedEventGraph = SerializedGraph;
