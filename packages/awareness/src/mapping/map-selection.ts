import { mapCursorThroughOperation } from "./map-cursor";
import type { PositionOperation, PositionRange } from "./position-operation";

/**
 * Map a selection range through a single insert or delete operation.
 *
 * Both endpoints are mapped independently with `mapCursorThroughOperation`,
 * then re-ordered so the returned range satisfies `from <= to`. A selection
 * fully inside a deletion collapses to a point at `op.index`.
 */
export const mapSelectionThroughOperation = (
  range: PositionRange,
  operation: PositionOperation,
): PositionRange => {
  const a = mapCursorThroughOperation(range.from, operation);
  const b = mapCursorThroughOperation(range.to, operation);
  return a <= b ? { from: a, to: b } : { from: b, to: a };
};
