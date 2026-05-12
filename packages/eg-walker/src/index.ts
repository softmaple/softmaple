/**
 * @softmaple/eg-walker - Eg-walker algorithm for collaborative editing
 *
 * Public, stable surface. For internal replay primitives
 * (engine, codec, ranked B-tree, critical-version, partial-replay) import
 * from `@softmaple/eg-walker/internal` — those names are not covered by
 * semver guarantees.
 */

export { EgWalkerReplica, createEgWalkerReplica } from "./core/replica";
export { ReplayWalker } from "./core/replay-walker";
export type { WalkerConfig, WalkResult } from "./core/replay-walker";
export { EventGraph } from "./graph/event-graph";
export { OPERATION_TYPE } from "./constants/operation-types";

export * from "./types";
