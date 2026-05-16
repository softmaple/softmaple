import {
  POSITION_OPERATION_TYPE,
  type PositionOperation,
} from "./position-operation";

/**
 * Map a cursor index through a single insert or delete operation.
 *
 * - Insert at `op.index`: a cursor strictly before the insert is unchanged;
 *   a cursor at or after the insert shifts right by `op.length`. The "at the
 *   insert" case advances the cursor so that the same characters remain to
 *   the left of it after the insert.
 * - Delete from `op.index` of `op.length` units: a cursor at or before the
 *   delete is unchanged; a cursor at or after the deleted range shifts left
 *   by `op.length`; a cursor inside the deleted range collapses to
 *   `op.index`.
 */
export const mapCursorThroughOperation = (
  cursor: number,
  operation: PositionOperation,
): number => {
  if (operation.type === POSITION_OPERATION_TYPE.Insert) {
    return cursor < operation.index ? cursor : cursor + operation.length;
  }

  const deleteEnd = operation.index + operation.length;
  if (cursor <= operation.index) {
    return cursor;
  }
  if (cursor >= deleteEnd) {
    return cursor - operation.length;
  }
  return operation.index;
};
