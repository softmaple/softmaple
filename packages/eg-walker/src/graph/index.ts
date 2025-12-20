/**
 * Event Graph module - Causal event ordering
 *
 * This module manages the persistent event graph that tracks
 * causal relationships between editing operations.
 */

export { EventGraph } from "./event-graph";
export {
  DefaultEventGraphWalker,
  type EventGraphWalker,
} from "./topological-walker";

export type { EventId, Version, GraphEvent as Event } from "../types";
