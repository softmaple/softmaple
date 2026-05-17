import {
  type RefObject,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";
import type { PositionOperation } from "../mapping/position-operation";
import {
  mapTextareaSelectionThroughOperation,
  type TextareaSelection,
  type TextareaSelectionDirection,
} from "./textarea-selection-sync";

export type UseTextareaSelectionSyncResult = {
  readonly captureSelection: () => TextareaSelection | null;
  readonly restoreSelection: (
    selection?: TextareaSelection | null,
  ) => TextareaSelection | null;
  readonly mapAndRestoreSelection: (
    operation: PositionOperation,
    selection?: TextareaSelection | null,
  ) => TextareaSelection | null;
};

const normalizeSelectionDirection = (
  direction: string | null,
): TextareaSelectionDirection => {
  if (
    direction === "forward" ||
    direction === "backward" ||
    direction === "none"
  ) {
    return direction;
  }
  return "none";
};

const clampSelectionToValue = (
  selection: TextareaSelection,
  valueLength: number,
): Required<TextareaSelection> => {
  const selectionStart = Math.min(
    Math.max(selection.selectionStart, 0),
    valueLength,
  );
  const selectionEnd = Math.min(
    Math.max(selection.selectionEnd, 0),
    valueLength,
  );
  return {
    selectionStart,
    selectionEnd,
    selectionDirection:
      selectionStart === selectionEnd
        ? "none"
        : (selection.selectionDirection ?? "none"),
  };
};

export const useTextareaSelectionSync = (
  textareaRef: RefObject<HTMLTextAreaElement | null>,
): UseTextareaSelectionSyncResult => {
  const selectionRef = useRef<TextareaSelection | null>(null);
  const pendingRestoreRef = useRef<TextareaSelection | null>(null);

  const captureSelection = useCallback((): TextareaSelection | null => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return null;
    }

    const selection = {
      selectionStart: textarea.selectionStart,
      selectionEnd: textarea.selectionEnd,
      selectionDirection: normalizeSelectionDirection(
        textarea.selectionDirection,
      ),
    } satisfies Required<TextareaSelection>;
    selectionRef.current = selection;
    return selection;
  }, [textareaRef]);

  const restoreToTextarea = useCallback(
    (selection: TextareaSelection): Required<TextareaSelection> | null => {
      const textarea = textareaRef.current;
      if (!textarea) {
        return null;
      }

      const nextSelection = clampSelectionToValue(
        selection,
        textarea.value.length,
      );
      textarea.setSelectionRange(
        nextSelection.selectionStart,
        nextSelection.selectionEnd,
        nextSelection.selectionDirection,
      );
      return nextSelection;
    },
    [textareaRef],
  );

  const restoreSelection = useCallback(
    (selection: TextareaSelection | null = selectionRef.current) => {
      if (!selection) {
        return null;
      }

      pendingRestoreRef.current = selection;
      selectionRef.current = selection;
      restoreToTextarea(selection);
      return selection;
    },
    [restoreToTextarea],
  );

  const mapAndRestoreSelection = useCallback(
    (
      operation: PositionOperation,
      selection: TextareaSelection | null = selectionRef.current ??
        captureSelection(),
    ) => {
      if (!selection) {
        return null;
      }

      const mappedSelection = mapTextareaSelectionThroughOperation(
        selection,
        operation,
      );
      return restoreSelection(mappedSelection);
    },
    [captureSelection, restoreSelection],
  );

  useLayoutEffect(() => {
    const pendingSelection = pendingRestoreRef.current;
    if (!pendingSelection) {
      return;
    }

    pendingRestoreRef.current = null;
    const restoredSelection = restoreToTextarea(pendingSelection);
    selectionRef.current = restoredSelection ?? pendingSelection;
  });

  return useMemo(
    () => ({
      captureSelection,
      restoreSelection,
      mapAndRestoreSelection,
    }),
    [captureSelection, restoreSelection, mapAndRestoreSelection],
  );
};
