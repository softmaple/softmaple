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
} from "./non-interleaving";

export type {
  CRDTItem,
  CRDTRun,
  TemporaryCRDTOptions,
  BlockOrderStrategy,
} from "../types";
