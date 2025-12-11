/**
 * Error codes for operation failures.
 * These provide structured error identification for debugging.
 */

export const ERROR_CODE = {
  CRDT_DESTROYED: "CRDT_DESTROYED",
  INVALID_INDEX: "INVALID_INDEX",
  INVALID_OPERATION: "INVALID_OPERATION",
  CYCLE_DETECTED: "CYCLE_DETECTED",
  VERSION_MISMATCH: "VERSION_MISMATCH",
  RECORD_NOT_FOUND: "RECORD_NOT_FOUND",
} as const;

export type ErrorCode = (typeof ERROR_CODE)[keyof typeof ERROR_CODE];
