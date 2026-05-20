/**
 * React wrapper around the pure `createTextareaBinding`.
 *
 * Owns binding construction/teardown across mounts, keeps the
 * subscriber callback fresh via a ref so a parent re-render doesn't
 * re-attach DOM listeners, and exposes the binding's API as stable
 * function references safe to depend on.
 *
 * The mount effect reconciles the ref's current DOM node after each
 * commit so replacing the underlying textarea tears down the old
 * binding and attaches to the new element.
 */

import { type RefObject, useCallback, useEffect, useRef } from "react";
import type { TextareaSelection } from "../../hooks/textarea-selection-sync";
import {
  createTextareaBinding,
  type TextareaSurfaceBinding,
} from "./textarea-binding";
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
  const bindingRef = useRef<TextareaSurfaceBinding | null>(null);
  const attachedElementRef = useRef<HTMLTextAreaElement | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const onLocalOperationsRef = useRef(options.onLocalOperations);
  const onCompositionChangeRef = useRef(options.onCompositionChange);

  // Keep callback refs fresh so binding setup does not depend on
  // identity-unstable inline arrows.
  onLocalOperationsRef.current = options.onLocalOperations;
  onCompositionChangeRef.current = options.onCompositionChange;

  const destroyAttachedBinding = useCallback((): void => {
    unsubscribeRef.current?.();
    unsubscribeRef.current = null;
    bindingRef.current?.destroy();
    bindingRef.current = null;
    attachedElementRef.current = null;
  }, []);

  useEffect(() => {
    const element = textareaRef.current;
    if (attachedElementRef.current === element) return;
    destroyAttachedBinding();
    if (!element) return;
    const binding = createTextareaBinding(element, {
      onCompositionChange: (composing) => {
        onCompositionChangeRef.current?.(composing);
      },
    });
    bindingRef.current = binding;
    const unsubscribe = binding.observeLocalOperations((operations) => {
      onLocalOperationsRef.current(operations);
    });
    attachedElementRef.current = element;
    unsubscribeRef.current = unsubscribe;
  });

  useEffect(() => destroyAttachedBinding, [destroyAttachedBinding]);

  const applyRemoteOperations = useCallback(
    (operations: readonly TextareaOperation[]) => {
      bindingRef.current?.applyRemoteOperations(operations);
    },
    [],
  );

  const getDocumentSnapshot = useCallback(
    () => bindingRef.current?.getDocumentSnapshot() ?? "",
    [],
  );

  const getSelection = useCallback(
    () => bindingRef.current?.getSelection() ?? null,
    [],
  );

  const restoreSelection = useCallback(
    (selection: TextareaSelection | null) => {
      bindingRef.current?.restoreSelection(selection);
    },
    [],
  );

  const mapSelectionThroughOperations = useCallback(
    (
      selection: TextareaSelection,
      operations: readonly TextareaOperation[],
    ): TextareaSelection => {
      const binding = bindingRef.current;
      if (binding) {
        return binding.mapSelectionThroughOperations(selection, operations);
      }
      // Binding not mounted yet (rare: ref not attached). Return
      // selection unchanged so callers don't get a different result by
      // racing the effect. Practically this only fires on the very
      // first paint before the element is attached, where no remote
      // ops should be applied anyway.
      return selection;
    },
    [],
  );

  const isComposing = useCallback(
    () => bindingRef.current?.isComposing() ?? false,
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
