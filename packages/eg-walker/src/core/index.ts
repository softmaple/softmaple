/**
 * Core module - Public replica and invariants
 *
 * This module provides the public-facing API that maintains
 * index-based operations and enforces strong list specification.
 */

export { EgWalkerReplica, createEgWalkerReplica } from "./replica";

export {
  verifyStrongListSpecification,
  ensureConvergence,
  validateIndexBounds,
  applyOperation,
  createDocumentState,
  linearizeEvents,
  topologicalSort,
  StrongListInvariant,
} from "./invariants";

export {
  ReplayWalker,
  type WalkerConfig,
  type WalkResult,
} from "./replay-walker";

export type { ExternalOperation, DocumentState } from "../types";
