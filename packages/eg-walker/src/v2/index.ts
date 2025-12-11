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

// Types
export type {
  // Core types
  ExternalOperation,
  Event,
  DocumentState,

  // CRDT types
  CRDTItem,
  CRDTRun,
  TemporaryCRDTOptions,

  // Graph types
  SerializedEventGraph,

  // Strategy types
  BlockOrderStrategy,
} from "./types";

// Core API
export { EgWalkerAPI } from "./core/external-api";

// Invariants and verification
export {
  verifyStrongListSpecification,
  ensureConvergence,
  validateIndexBounds,
} from "./core/invariants";

// CRDT utilities (internal use)
export { TemporaryCRDT, withTemporaryCRDT } from "./crdt/temporary-state";

export {
  groupIntoRuns,
  ensureNonInterleaving,
  BLOCK_ORDER_STRATEGIES,
} from "./crdt/non-interleaving";

// Event graph
export { EventGraph } from "./graph/event-graph";
