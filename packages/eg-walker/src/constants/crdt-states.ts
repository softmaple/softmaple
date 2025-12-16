/**
 * CRDT state constants for internal state management.
 * These states track the visibility and lifecycle of CRDT records.
 */

/**
 * Prepare state types - intermediate state during retreat operations.
 * These states are used when walking backwards through the event graph.
 */
export const PREPARE_STATE_TYPE = {
  VISIBLE: "visible",
  DELETED: "deleted",
  NOT_YET_INSERTED: "not-yet-inserted",
} as const;

export type PrepareStateType =
  (typeof PREPARE_STATE_TYPE)[keyof typeof PREPARE_STATE_TYPE];

/**
 * Effect state types - final state after advance operations.
 * These states represent the final visibility of records.
 */
export const EFFECT_STATE_TYPE = {
  VISIBLE: "visible",
  DELETED: "deleted",
} as const;

export type EffectStateType =
  (typeof EFFECT_STATE_TYPE)[keyof typeof EFFECT_STATE_TYPE];
