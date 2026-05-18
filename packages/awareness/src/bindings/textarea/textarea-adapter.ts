/**
 * Textarea reference adapter.
 *
 * Concrete `CollaborationAdapter` implementation for a plain `<textarea>`.
 * Framework-free: constructed from an `HTMLTextAreaElement`, attaches its
 * own DOM event listeners, and exposes an `observeLocalOperations`
 * callback plus an `applyRemoteOperations` push API. The React hook in
 * `use-textarea-collaboration.ts` is a thin wrapper over this.
 *
 * Owns the IME composition state machine that previously lived inline in
 * the playground's `EditorSurface` component (intermediate `input`
 * suppression, Chrome/WebKit trailing-input echo swallow,
 * `blur`-as-defensive-reset for IMEs that drop `compositionend`).
 *
 * Does not own: the CRDT, the transport, presence broadcasting, the
 * overlay UI. Callers wire those.
 */

import {
  mapTextareaSelectionThroughOperation,
  type TextareaSelection,
  type TextareaSelectionDirection,
} from "../../hooks/textarea-selection-sync";
import type {
  AdapterSubscription,
  CollaborationAdapter,
} from "../../types/editor";
import {
  applyOperationsToText,
  computeTextareaOperations,
  type TextareaOperation,
} from "./textarea-operations";

export type TextareaAdapterOptions = {
  /**
   * Notified whenever the adapter enters or leaves IME composition.
   * Useful for presence wiring that wants to suppress typing/selection
   * broadcasts mid-composition.
   */
  readonly onCompositionChange?: (composing: boolean) => void;
};

export interface TextareaCollaborationAdapter
  extends CollaborationAdapter<number, TextareaSelection, TextareaOperation> {
  getDocumentSnapshot(): string;
  applyLocalOperation(operation: TextareaOperation): void;
  applyRemoteOperations(operations: readonly TextareaOperation[]): void;
  observeLocalOperations(
    callback: (operations: readonly TextareaOperation[]) => void,
  ): AdapterSubscription;
  getSelection(): TextareaSelection | null;
  restoreSelection(selection: TextareaSelection | null): void;
  mapSelectionThroughOperations(
    selection: TextareaSelection,
    operations: readonly TextareaOperation[],
  ): TextareaSelection;
  /** Whether the textarea is currently mid-IME-composition. */
  isComposing(): boolean;
  destroy(): void;
}

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

const clampSelection = (
  selection: TextareaSelection,
  valueLength: number,
): Required<TextareaSelection> => {
  const clampedStart = Math.min(
    Math.max(selection.selectionStart, 0),
    valueLength,
  );
  const clampedEnd = Math.min(Math.max(selection.selectionEnd, 0), valueLength);
  const start = Math.min(clampedStart, clampedEnd);
  const end = Math.max(clampedStart, clampedEnd);
  const direction =
    clampedStart > clampedEnd
      ? flipSelectionDirection(selection.selectionDirection)
      : (selection.selectionDirection ?? "none");
  return {
    selectionStart: start,
    selectionEnd: end,
    selectionDirection: start === end ? "none" : direction,
  };
};

export const createTextareaAdapter = (
  element: HTMLTextAreaElement,
  options: TextareaAdapterOptions = {},
): TextareaCollaborationAdapter => {
  const subscribers = new Set<
    (operations: readonly TextareaOperation[]) => void
  >();
  // Diff baseline. Updated on every dispatch (local input / remote
  // apply) so the next input event diffs against the freshly-known
  // text rather than re-emitting characters the remote already
  // contributed.
  let lastValue = element.value;
  let composing = false;
  // Chrome / WebKit dispatch a trailing `input` immediately after
  // `compositionend` whose value equals the post-commit text. The
  // compositionend handler already dispatched, so the next input must
  // swallow that single echo. Firefox skips the trailing input; the
  // ref simply lingers until consumed (and ignored) by a real
  // keystroke.
  let lastCompositionCommit: string | null = null;

  const setComposing = (next: boolean): void => {
    if (composing === next) return;
    composing = next;
    options.onCompositionChange?.(next);
  };

  const emit = (operations: readonly TextareaOperation[]): void => {
    if (operations.length === 0) return;
    for (const subscriber of subscribers) {
      subscriber(operations);
    }
  };

  const diffAndEmit = (currentValue: string): void => {
    const operations = computeTextareaOperations(lastValue, currentValue);
    lastValue = currentValue;
    emit(operations);
  };

  const handleInput = (): void => {
    if (composing) return;
    const value = element.value;
    if (lastCompositionCommit !== null) {
      const expected = lastCompositionCommit;
      lastCompositionCommit = null;
      if (value === expected) {
        // Swallow Chrome/WebKit's trailing post-commit input echo.
        // `lastValue` was already updated by the compositionend
        // handler; do not re-diff.
        return;
      }
    }
    diffAndEmit(value);
  };

  const handleCompositionStart = (): void => {
    setComposing(true);
  };

  const handleCompositionEnd = (): void => {
    setComposing(false);
    const value = element.value;
    lastCompositionCommit = value;
    diffAndEmit(value);
  };

  const handleBlur = (): void => {
    // Defensive reset for mobile / older WebKit IMEs that can drop
    // `compositionend` when focus is yanked mid-composition. Without
    // this, `composing` would stay true and every later keystroke
    // would be silently swallowed.
    setComposing(false);
    lastCompositionCommit = null;
  };

  element.addEventListener("input", handleInput);
  element.addEventListener("compositionstart", handleCompositionStart);
  element.addEventListener("compositionend", handleCompositionEnd);
  element.addEventListener("blur", handleBlur);

  let destroyed = false;

  const getSelection = (): TextareaSelection | null => {
    if (destroyed) return null;
    return {
      selectionStart: element.selectionStart,
      selectionEnd: element.selectionEnd,
      selectionDirection: normalizeSelectionDirection(
        element.selectionDirection,
      ),
    };
  };

  const restoreSelection = (selection: TextareaSelection | null): void => {
    if (!selection || destroyed) return;
    const clamped = clampSelection(selection, element.value.length);
    element.setSelectionRange(
      clamped.selectionStart,
      clamped.selectionEnd,
      clamped.selectionDirection,
    );
  };

  const mapSelectionThroughOperations = (
    selection: TextareaSelection,
    operations: readonly TextareaOperation[],
  ): TextareaSelection =>
    operations.reduce<TextareaSelection>(
      (current, operation) =>
        mapTextareaSelectionThroughOperation(current, operation),
      selection,
    );

  const applyRemoteOperations = (
    operations: readonly TextareaOperation[],
  ): void => {
    if (destroyed) return;
    if (operations.length === 0) return;
    // Skip mid-composition: writing element.value would collapse the
    // in-progress IME composition. Caller can re-send after
    // compositionend (the next input dispatch will re-diff anyway).
    if (composing) return;

    const previousSelection = getSelection();
    const previousValue = element.value;
    const nextValue = applyOperationsToText(previousValue, operations);
    if (nextValue === previousValue) {
      // Pure no-op batch (e.g. delete of zero-width range). Don't
      // touch the DOM — preserves caret and avoids spurious input
      // event dispatch on some browsers.
      lastValue = nextValue;
      return;
    }

    element.value = nextValue;
    lastValue = nextValue;
    if (previousSelection) {
      const mapped = mapSelectionThroughOperations(
        previousSelection,
        operations,
      );
      restoreSelection(mapped);
    }
  };

  return {
    getDocumentSnapshot: () => element.value,
    applyLocalOperation: () => {
      // No-op: the DOM is canonical for local edits. The input listener
      // already fires `observeLocalOperations` subscribers with the
      // derived operation; there is nothing more to apply.
    },
    applyRemoteOperations,
    observeLocalOperations: (callback) => {
      subscribers.add(callback);
      return () => {
        subscribers.delete(callback);
      };
    },
    getSelection,
    restoreSelection,
    mapSelectionThroughOperations,
    isComposing: () => composing,
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      subscribers.clear();
      element.removeEventListener("input", handleInput);
      element.removeEventListener("compositionstart", handleCompositionStart);
      element.removeEventListener("compositionend", handleCompositionEnd);
      element.removeEventListener("blur", handleBlur);
    },
  };
};
