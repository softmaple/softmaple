/**
 * Algorithm configuration constants.
 * These control the behavior and performance characteristics of the walker.
 */

export const ALGORITHM_DEFAULTS = {
  /**
   * Maximum lifetime for temporary CRDT state (in milliseconds)
   */
  MAX_CRDT_LIFETIME: 5000,

  /**
   * Minimum run length for non-interleaving behavior
   */
  MIN_RUN_LENGTH: 1,

  /**
   * Default tie-breaker strategy for concurrent operations
   */
  TIE_BREAKER: "timestamp" as const,
} as const;

export const PERFORMANCE_THRESHOLDS = {
  /**
   * Minimum number of records to trigger B-tree indexing
   */
  BTREE_THRESHOLD: 1000,

  /**
   * Maximum time for transform operation (milliseconds)
   */
  MAX_TRANSFORM_TIME: 100,

  /**
   * Batch size for bulk operations
   */
  BATCH_SIZE: 100,
} as const;
