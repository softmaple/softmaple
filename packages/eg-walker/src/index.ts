/**
 * @softmaple/eg-walker - Eg-walker algorithm for collaborative editing
 *
 * Implementation of the Eg-walker algorithm for collaborative text editing
 */

// Core exports from v2 implementation
export { EgWalker } from "./core/walker";
export { EgWalkerAPI } from "./core/external-api";
export { EventGraph } from "./graph/event-graph";
export { InternalCRDTState } from "./crdt/internal-state";
export type { CriticalVersionDetector } from "./core/critical-version";
export { DefaultCriticalVersionDetector } from "./core/critical-version";

// Constants exports
export { OPERATION_TYPE } from "./constants/operation-types";
export { PREPARE_STATE_TYPE, EFFECT_STATE_TYPE } from "./constants/crdt-states";
export { CRDT_SENTINELS } from "./constants/sentinels";
export type { SentinelId } from "./constants/sentinels";

// Type exports
export * from "./types";

// Default export
export { EgWalker as default } from "./core/walker";
