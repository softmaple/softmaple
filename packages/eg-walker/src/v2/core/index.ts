/**
 * Core module - External API and invariants
 *
 * This module provides the public-facing API that maintains
 * index-based operations and enforces strong list specification.
 */

export { EgWalkerAPI } from "./external-api";

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

// Section 3.2 exports
export { EgWalker, type WalkerConfig, type WalkResult } from "./walker";
export {
  FrontierVersion,
  compareVersions,
  VersionAlignmentManager,
  type VersionDiff,
} from "./version-alignment";

export type { ExternalOperation, DocumentState } from "../types";
