/**
 * Eg-walker v2 - Section 3.1 Characteristics Implementation
 *
 * This module implements the fundamental invariants of the Eg-walker algorithm:
 * - Strong list specification
 * - Maximally non-interleaving behavior
 * - Temporary CRDT state
 * - Index-based external API
 * - No persistent CRDT metadata
 */

// Section 3.2 additions
export { EgWalker, type WalkerConfig, type WalkResult } from "./core/walker";
export {
  FrontierVersion,
  compareVersions,
  VersionAlignmentManager,
  type VersionDiff,
} from "./core/version-alignment";
export {
  DefaultEventGraphWalker,
  type EventGraphWalker,
} from "./graph/topological-walker";
export {
  StubInternalCRDT,
  type InternalCRDTState,
} from "./crdt/retreat-advance-stubs";

// Types
export type {
  // Core types
  ExternalOperation,
  DocumentState,
  EventId,
  Version,
  GraphEvent,
  GraphEvent as Event,
  // CRDT types
  CRDTItem,
  PrepareState,
  EffectState,
  OrderingRule,
  ListInvariant,
  NonInterleavingConfig,
  EgWalkerConstraints,
} from "./types";

// Core API
export { EgWalkerAPI } from "./core/external-api";

// Invariants and verification
export {
  verifyStrongListSpecification,
  ensureConvergence,
  validateIndexBounds,
  applyOperation,
  createDocumentState,
  linearizeEvents,
  topologicalSort,
  StrongListInvariant,
} from "./core/invariants";

// CRDT utilities (internal use)
export { TemporaryCRDT, withTemporaryCRDT } from "./crdt/temporary-state";

export {
  groupIntoRuns,
  ensureNonInterleaving,
  verifyNonInterleaving,
  BLOCK_ORDER_STRATEGIES,
  NonInterleavingOrder,
  mergeRuns,
  type InsertionRun,
} from "./crdt/non-interleaving";

// Event graph
export {
  EventGraph,
  type GraphEvent as GraphEventExport,
} from "./graph/event-graph";
