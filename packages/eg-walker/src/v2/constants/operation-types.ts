/**
 * Operation type constants for external operations.
 * These are the only operation types exposed through the public API.
 */

export const OPERATION_TYPE = {
  INSERT: "insert",
  DELETE: "delete",
} as const;

export type OperationType =
  (typeof OPERATION_TYPE)[keyof typeof OPERATION_TYPE];
