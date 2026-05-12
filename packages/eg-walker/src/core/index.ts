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

export { EgWalker, type WalkerConfig, type WalkResult } from "./walker";

export type { ExternalOperation, DocumentState } from "../types";
