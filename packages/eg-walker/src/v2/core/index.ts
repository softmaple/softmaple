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
} from "./invariants";

export type { ExternalOperation, DocumentState } from "../types";
