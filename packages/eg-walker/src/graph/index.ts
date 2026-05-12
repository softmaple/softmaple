/**
 * Event Graph module - Causal event ordering
 *
 * This module manages the persistent event graph that tracks
 * causal relationships between editing operations.
 */

export { EventGraph } from "./event-graph";
export {
  ColumnarEventGraphCodec,
  type ColumnarEventGraph,
  type IdRun,
  type OperationRun,
  type ParentOverride,
} from "./columnar-codec";

export type { EventId, Version, GraphEvent } from "../types";
