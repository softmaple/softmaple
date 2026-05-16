/**
 * Editor-agnostic operation shapes over an index-based 1D sequence.
 *
 * These types describe a position change without taking a dependency on any
 * specific editor model (plain text, rich text linearised, block editor,
 * canvas, node-based, IDE-like). Callers using a different unit (graphemes,
 * UTF-32 code points) provide indices and lengths in that same unit.
 */

export const POSITION_OPERATION_TYPE = {
  Insert: "insert",
  Delete: "delete",
} as const;

export type PositionOperationType =
  (typeof POSITION_OPERATION_TYPE)[keyof typeof POSITION_OPERATION_TYPE];

export type InsertOperation = {
  readonly type: typeof POSITION_OPERATION_TYPE.Insert;
  readonly index: number;
  readonly length: number;
};

export type DeleteOperation = {
  readonly type: typeof POSITION_OPERATION_TYPE.Delete;
  readonly index: number;
  readonly length: number;
};

export type PositionOperation = InsertOperation | DeleteOperation;

export type PositionRange = {
  readonly from: number;
  readonly to: number;
};
