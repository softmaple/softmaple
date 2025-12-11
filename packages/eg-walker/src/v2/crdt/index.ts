/**
 * CRDT module - Temporary internal ordering logic
 *
 * This module provides temporary CRDT state management for
 * transformation operations. All CRDT state is ephemeral and
 * never persisted to disk.
 */

export { TemporaryCRDT, withTemporaryCRDT } from "./temporary-state";

export {
  groupIntoRuns,
  ensureNonInterleaving,
  BLOCK_ORDER_STRATEGIES,
  verifyNonInterleaving,
  NonInterleavingOrder,
  mergeRuns,
  type InsertionRun,
} from "./non-interleaving";

export {
  StubInternalCRDT,
  type InternalCRDTState,
} from "./retreat-advance-stubs";

// Section 3.3 exports
export {
  InternalCRDTState as InternalCRDTStateImpl,
  withInternalState,
  type Record,
  type PrepareState as PrepareStateInternal,
  type EffectState as EffectStateInternal,
} from "./internal-state";

export {
  ConcreteCRDTState,
  RetreatAdvanceCoordinator,
  withCoordinator,
} from "./retreat-advance";

export type {
  CRDTItem,
  PrepareState,
  EffectState,
  OrderingRule,
} from "../types";
