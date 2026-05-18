/**
 * React wrapper around the pure `createTextareaAdapter`.
 *
 * Owns adapter construction/teardown across mounts, keeps the
 * subscriber callback fresh via a ref so a parent re-render doesn't
 * re-attach DOM listeners, and exposes the adapter's API as stable
 * function references safe to depend on.
 *
 * Constraint: the mount effect depends on the `textareaRef` *object*
 * identity, not on its `.current` value. If the underlying textarea
 * element is replaced after the component mounts (e.g. via `key`
 * churn or a conditional render that unmounts then remounts the
 * `<textarea>`), the adapter will not re-attach to the new element.
 * Consumers that need that lifecycle should re-mount the component
 * itself (so the hook itself unmounts and remounts) rather than
 * swapping the underlying element through the same ref.
 */

import { type RefObject, useCallback, useEffect, useRef } from "react";
import type { TextareaSelection } from "../../hooks/textarea-selection-sync";
import {
  createTextareaAdapter,
  type TextareaCollaborationAdapter,
} from "./textarea-adapter";
import type { TextareaOperation } from "./textarea-operations";

export type UseTextareaCollaborationOptions = {
  readonly textareaRef: RefObject<HTMLTextAreaElement | null>;
  /**
   * Fired with the operations derived from each local edit. Stored in a
   * ref so passing an inline arrow does not trigger adapter re-creation.
   */
  readonly onLocalOperations: (
    operations: readonly TextareaOperation[],
  ) => void;
  /**
   * Notified when the textarea enters or leaves IME composition. Same
   * ref-based freshness handling as `onLocalOperations`.
   */
  readonly onCompositionChange?: (composing: boolean) => void;
};

export type UseTextareaCollaborationResult = {
  readonly applyRemoteOperations: (
    operations: readonly TextareaOperation[],
  ) => void;
  readonly getDocumentSnapshot: () => string;
  readonly getSelection: () => TextareaSelection | null;
  readonly restoreSelection: (selection: TextareaSelection | null) => void;
  readonly mapSelectionThroughOperations: (
    selection: TextareaSelection,
    operations: readonly TextareaOperation[],
  ) => TextareaSelection;
  readonly isComposing: () => boolean;
};

export const useTextareaCollaboration = (
  options: UseTextareaCollaborationOptions,
): UseTextareaCollaborationResult => {
  const { textareaRef } = options;
  const adapterRef = useRef<TextareaCollaborationAdapter | null>(null);
  const onLocalOperationsRef = useRef(options.onLocalOperations);
  const onCompositionChangeRef = useRef(options.onCompositionChange);

  // Keep callback refs fresh so adapter setup does not depend on
  // identity-unstable inline arrows.
  onLocalOperationsRef.current = options.onLocalOperations;
  onCompositionChangeRef.current = options.onCompositionChange;

  useEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    const adapter = createTextareaAdapter(element, {
      onCompositionChange: (composing) => {
        onCompositionChangeRef.current?.(composing);
      },
    });
    adapterRef.current = adapter;
    const unsubscribe = adapter.observeLocalOperations((operations) => {
      onLocalOperationsRef.current(operations);
    });
    return () => {
      unsubscribe();
      adapter.destroy();
      adapterRef.current = null;
    };
  }, [textareaRef]);

  const applyRemoteOperations = useCallback(
    (operations: readonly TextareaOperation[]) => {
      adapterRef.current?.applyRemoteOperations(operations);
    },
    [],
  );

  const getDocumentSnapshot = useCallback(
    () => adapterRef.current?.getDocumentSnapshot() ?? "",
    [],
  );

  const getSelection = useCallback(
    () => adapterRef.current?.getSelection() ?? null,
    [],
  );

  const restoreSelection = useCallback(
    (selection: TextareaSelection | null) => {
      adapterRef.current?.restoreSelection(selection);
    },
    [],
  );

  const mapSelectionThroughOperations = useCallback(
    (
      selection: TextareaSelection,
      operations: readonly TextareaOperation[],
    ): TextareaSelection => {
      const adapter = adapterRef.current;
      if (adapter) {
        return adapter.mapSelectionThroughOperations(selection, operations);
      }
      // Adapter not mounted yet (rare: ref not attached). Return
      // selection unchanged so callers don't get a different result by
      // racing the effect. Practically this only fires on the very
      // first paint before the element is attached, where no remote
      // ops should be applied anyway.
      return selection;
    },
    [],
  );

  const isComposing = useCallback(
    () => adapterRef.current?.isComposing() ?? false,
    [],
  );

  return {
    applyRemoteOperations,
    getDocumentSnapshot,
    getSelection,
    restoreSelection,
    mapSelectionThroughOperations,
    isComposing,
  };
};
