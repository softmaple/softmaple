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

type PendingTextareaSelectionRestore = {
  readonly selection: TextareaSelection;
  readonly value: string;
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

const flipSelectionDirection = (
  direction: TextareaSelectionDirection | undefined,
): TextareaSelectionDirection => {
  if (direction === "forward") {
    return "backward";
  }
  if (direction === "backward") {
    return "forward";
  }
  return "none";
};

const clampSelectionToValue = (
  selection: TextareaSelection,
  valueLength: number,
): Required<TextareaSelection> => {
  const clampedStart = Math.min(
    Math.max(selection.selectionStart, 0),
    valueLength,
  );
  const clampedEnd = Math.min(Math.max(selection.selectionEnd, 0), valueLength);
  const selectionStart = Math.min(clampedStart, clampedEnd);
  const selectionEnd = Math.max(clampedStart, clampedEnd);
  const selectionDirection =
    clampedStart > clampedEnd
      ? flipSelectionDirection(selection.selectionDirection)
      : (selection.selectionDirection ?? "none");

  return {
    selectionStart,
    selectionEnd,
    selectionDirection:
      selectionStart === selectionEnd ? "none" : selectionDirection,
  };
};

const restoreToTextarea = (
  textarea: HTMLTextAreaElement,
  selection: TextareaSelection,
): Required<TextareaSelection> => {
  const nextSelection = clampSelectionToValue(selection, textarea.value.length);
  textarea.setSelectionRange(
    nextSelection.selectionStart,
    nextSelection.selectionEnd,
    nextSelection.selectionDirection,
  );
  return nextSelection;
};

export const useTextareaSelectionSync = (
  textareaRef: RefObject<HTMLTextAreaElement | null>,
): UseTextareaSelectionSyncResult => {
  const selectionRef = useRef<TextareaSelection | null>(null);
  const pendingRestoreRef = useRef<PendingTextareaSelectionRestore | null>(
    null,
  );

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

  const restoreSelection = useCallback(
    (selection: TextareaSelection | null = selectionRef.current) => {
      const textarea = textareaRef.current;
      if (!selection || !textarea) {
        return null;
      }

      const restoredSelection = restoreToTextarea(textarea, selection);
      pendingRestoreRef.current = {
        selection,
        value: textarea.value,
      };
      selectionRef.current = restoredSelection;
      return restoredSelection;
    },
    [textareaRef],
  );

  const mapAndRestoreSelection = useCallback(
    (operation: PositionOperation, selection?: TextareaSelection | null) => {
      const currentSelection =
        selection === undefined
          ? (selectionRef.current ?? captureSelection())
          : selection;
      if (!currentSelection) {
        return null;
      }

      const mappedSelection = mapTextareaSelectionThroughOperation(
        currentSelection,
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
    const textarea = textareaRef.current;
    if (!textarea || textarea.value === pendingSelection.value) {
      return;
    }

    selectionRef.current = restoreToTextarea(
      textarea,
      pendingSelection.selection,
    );
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
