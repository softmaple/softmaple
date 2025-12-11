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

export type {
  CRDTItem,
  PrepareState,
  EffectState,
  OrderingRule,
} from "../types";
