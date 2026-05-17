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
  /**
   * Capture the textarea's current DOM selection.
   */
  readonly captureSelection: () => TextareaSelection | null;
  /**
   * Restore a selection immediately against the textarea's current value.
   *
   * The returned selection reflects that synchronous restore and may be
   * clamped to the current value length. If React commits a textarea value
   * change in the same batch, the hook re-applies the requested selection
   * after commit against the new value.
   */
  readonly restoreSelection: (
    selection?: TextareaSelection | null,
  ) => TextareaSelection | null;
  /**
   * Map a selection through an operation and restore it immediately.
   *
   * The returned selection reflects the synchronous restore against the
   * textarea's current value. When the textarea value changes in the same
   * React batch, the post-commit layout effect restores the mapped selection
   * again against the new value.
   *
   * Omit `selection` to use the last captured selection; pass `null` to return
   * `null` without restoring.
   */
  readonly mapAndRestoreSelection: (
    operation: PositionOperation,
    selection?: TextareaSelection | null,
  ) => TextareaSelection | null;
};

type PendingTextareaSelectionRestore = {
  readonly id: number;
  readonly selection: TextareaSelection;
  readonly value: string;
};

type PendingTextareaSelectionRestoreRef = {
  current: PendingTextareaSelectionRestore | null;
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

const schedulePendingRestoreExpiration = (
  restoreId: number,
  pendingRestoreRef: PendingTextareaSelectionRestoreRef,
): void => {
  queueMicrotask(() => {
    if (pendingRestoreRef.current?.id === restoreId) {
      pendingRestoreRef.current = null;
    }
  });
};

export const useTextareaSelectionSync = (
  textareaRef: RefObject<HTMLTextAreaElement | null>,
): UseTextareaSelectionSyncResult => {
  const selectionRef = useRef<TextareaSelection | null>(null);
  const restoreIdRef = useRef(0);
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
      const restoreId = restoreIdRef.current + 1;
      restoreIdRef.current = restoreId;
      pendingRestoreRef.current = {
        id: restoreId,
        selection,
        value: textarea.value,
      };
      schedulePendingRestoreExpiration(restoreId, pendingRestoreRef);
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

  // Intentionally runs after every commit so a restore requested in the same
  // batch as a textarea value update can be re-applied after the new value lands.
  // Pending restores expire in a microtask, so they cannot leak into later work.
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
