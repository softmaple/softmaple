import { mapSelectionThroughOperation } from "../mapping/map-selection";
import type { PositionOperation } from "../mapping/position-operation";

export type TextareaSelectionDirection = "forward" | "backward" | "none";

export type TextareaSelection = {
  readonly selectionStart: number;
  readonly selectionEnd: number;
  readonly selectionDirection?: TextareaSelectionDirection;
};

/**
 * Map a textarea's local selection through a remote text operation.
 *
 * This helper is DOM-independent so the textarea hook can keep browser wiring
 * small while sharing the same operation-based selection behavior as other
 * awareness consumers.
 */
export const mapTextareaSelectionThroughOperation = (
  selection: TextareaSelection,
  operation: PositionOperation,
): Required<TextareaSelection> => {
  const mapped = mapSelectionThroughOperation(
    {
      from: selection.selectionStart,
      to: selection.selectionEnd,
    },
    operation,
  );

  return {
    selectionStart: mapped.from,
    selectionEnd: mapped.to,
    selectionDirection: selection.selectionDirection ?? "none",
  };
};
