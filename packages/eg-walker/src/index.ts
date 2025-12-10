/**
 * @softmaple/eg-walker - Eg-walker algorithm for collaborative editing
 *
 * Implementation of the Eg-walker algorithm for collaborative text editing
 */

// Core exports
export { EgWalker } from "./eg-walker";
export { EventStorage } from "./event-storage";
export { CausalGraph } from "./causal-graph";
export { CRDT, START_ID, END_ID } from "./crdt";

// Functional module exports
// FP utilities exported directly from submodules
export * as fpArray from "./fp/utils/array";
export * as fpComposition from "./fp/utils/composition";
export * as fpVersion from "./fp/utils/version";
export * as fpEvent from "./fp/utils/event";
export * as fpDocument from "./fp/utils/document";
export {
  serializeEvents,
  deserializeEvents,
  calculateStorageStats,
  encodeVarInt,
  decodeVarInt,
} from "./fp/storage/columnar-storage";
export {
  FunctionalEgWalker,
  createEgWalker,
  createEgWalkerWithEvents,
} from "./fp/core/eg-walker";

// Type exports
export {
  type Event,
  type EventId,
  type EventType,
  type Position,
  type Version,
  type PrepareState,
  type AugmentedCRDTItem,
  spaceInPrepareState,
  spaceInEffectState,
} from "./types";

// Default export
export { EgWalker as default } from "./eg-walker";
