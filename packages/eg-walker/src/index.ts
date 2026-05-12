/**
 * @softmaple/eg-walker - Eg-walker algorithm for collaborative editing
 *
 * Implementation of the Eg-walker algorithm for collaborative text editing
 */

export { EgWalker } from "./core/walker";
export { EgWalkerEngine } from "./engine/eg-walker-engine";
export {
  IndexedSequence,
  CriticalVersionAnalyzer,
  PartialReplayManager,
} from "./engine";
export { ColumnarEventGraphCodec } from "./graph";
export { EgWalkerReplica, createEgWalkerReplica } from "./core/replica";
export { EventGraph } from "./graph/event-graph";

// Constants exports
export { OPERATION_TYPE } from "./constants/operation-types";

// Type exports
export * from "./types";

// Default export
export { EgWalker as default } from "./core/walker";
