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

export type {
  PositionOperation,
  InsertPositionOperation,
  DeletePositionOperation,
} from "./position-operation";
export {
  APPLY_REMOTE_EVENT_STATUS,
  type ApplyRemoteEventResult,
  type ApplyRemoteEventStatus,
  type IntegratedApplyRemoteEventResult,
  type BufferedApplyRemoteEventResult,
  type DuplicateApplyRemoteEventResult,
} from "./apply-remote-event-result";
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
 * Serialized version input: shape accepted by `EventGraph.deserialize()`.
 * Covers the JSON-safe array form, in-memory `Set` instances, and generic
 * iterables. (`Set` and `ReadonlyArray` are themselves `Iterable`; the three
 * entries are listed separately for documentation.)
 */
export type SerializedVersionInput =
  | ReadonlyArray<EventId>
  | ReadonlySet<EventId>
  | Iterable<EventId>;

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
