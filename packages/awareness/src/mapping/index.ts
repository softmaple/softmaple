export { mapCursorThroughOperation } from "./map-cursor";
export { mapSelectionThroughOperation } from "./map-selection";
export {
  type DeleteOperation,
  type InsertOperation,
  POSITION_OPERATION_TYPE,
  type PositionOperation,
  type PositionOperationType,
  type PositionRange,
} from "./position-operation";
export {
  type ChangedSpan,
  findChangedSpan,
  findDeletePosition,
  findDifferingRange,
  findInsertPosition,
} from "./text-diff";
