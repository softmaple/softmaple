import { mapCursorThroughOperation } from "./map-cursor";
import {
  POSITION_OPERATION_TYPE,
  type PositionOperation,
  type PositionRange,
} from "./position-operation";

/**
 * Map a selection range through a single insert or delete operation.
 *
 * Selections are treated as half-open `[from, to)`. To prevent an insert at
 * the trailing boundary from swallowing the new text into the selection,
 * boundary biases are asymmetric for inserts on non-collapsed selections:
 *
 * - `from` is right-biased (matches `mapCursorThroughOperation`): an insert
 *   at `from` shifts the leading boundary past the new text.
 * - `to` is left-biased for non-collapsed inserts: an insert exactly at `to`
 *   keeps the trailing boundary put so the new text lands outside the
 *   selection. For inserts strictly inside the range, `to` still advances.
 * - Collapsed selections (`from === to`) keep symmetric right-bias on both
 *   endpoints so a point cursor doesn't expand into a non-empty selection.
 *
 * Delete operations route both endpoints through
 * `mapCursorThroughOperation`; a selection fully inside a deletion collapses
 * to `op.index`.
 *
 * The returned range is normalised so `from <= to`. Callers tracking
 * anchor/head orientation should re-derive it from the input endpoints.
 */
export const mapSelectionThroughOperation = (
  range: PositionRange,
  operation: PositionOperation,
): PositionRange => {
  const low = Math.min(range.from, range.to);
  const high = Math.max(range.from, range.to);

  const mappedLow = mapCursorThroughOperation(low, operation);

  const useLeftBiasOnHigh =
    operation.type === POSITION_OPERATION_TYPE.Insert && low !== high;
  const mappedHigh = useLeftBiasOnHigh
    ? high <= operation.index
      ? high
      : high + operation.length
    : mapCursorThroughOperation(high, operation);

  return mappedLow <= mappedHigh
    ? { from: mappedLow, to: mappedHigh }
    : { from: mappedHigh, to: mappedLow };
};
