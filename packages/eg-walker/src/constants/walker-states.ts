/**
 * Walker state constants for tracking graph traversal.
 * These states indicate the current phase of the walker algorithm.
 */

export const WALKER_STATE = {
  IDLE: "idle",
  RETREATING: "retreating",
  ADVANCING: "advancing",
  TRANSFORMING: "transforming",
} as const;

export type WalkerState = (typeof WALKER_STATE)[keyof typeof WALKER_STATE];

/**
 * Transform actions that can be taken during graph walking.
 */
export const TRANSFORM_ACTION = {
  RETREAT: "retreat",
  ADVANCE: "advance",
  SKIP: "skip",
  APPLY: "apply",
} as const;

export type TransformAction =
  (typeof TRANSFORM_ACTION)[keyof typeof TRANSFORM_ACTION];
