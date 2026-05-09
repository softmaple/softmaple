/**
 * Core module - External API and invariants
 *
 * This module provides the public-facing API that maintains
 * index-based operations and enforces strong list specification.
 */

export { EgWalkerAPI, createEgWalker } from "./external-api";

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
