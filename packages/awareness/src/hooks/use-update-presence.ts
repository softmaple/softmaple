/**
 * useUpdatePresence hook - Update current user's presence
 */

import { useContext } from "react";
import { PresenceContext } from "../providers/presence-context";
import type {
  CursorPosition,
  PointerPosition,
  SelectionRange,
} from "../types/presence";
import { useTrailingEdgeThrottle } from "./internal/use-trailing-throttle";

export { useUpdateTyping } from "./use-update-typing";

const PROVIDER_ERROR_MSG =
  "must be used within a PresenceProvider. " +
  "Wrap your component tree with <PresenceProvider adapter={adapter}>.";

/**
 * Default cursor throttle window. ~60fps — matches the design doc's "Cursor
 * updates throttled (50-100ms)" budget while staying snappy for fast-moving
 * pointers.
 */
const DEFAULT_CURSOR_THROTTLE_MS = 16;

/**
 * Default selection throttle window. Per design doc §7 ("Cursor updates
 * throttled (50-100ms)") — selections fire on every `selectionchange` during
 * a drag, so a coarser default than cursor is appropriate.
 */
const DEFAULT_SELECTION_THROTTLE_MS = 50;

/** Default pointer throttle window. Pointer streams are high-frequency. */
const DEFAULT_POINTER_THROTTLE_MS = 32;

/**
 * "Clear" sentinel accepted by `useUpdateCursor` / `useUpdateSelection`. Both
 * `null` and `undefined` mean "I have no cursor / selection right now". The
 * adapter normalizes the wire representation so peers receive an unambiguous
 * clear signal.
 */
type Clear = null | undefined;

/**
 * Hook to get the updatePresence function
 * @returns Function to update presence
 * @throws Error if used outside of PresenceProvider
 */
export const useUpdatePresence = () => {
  const context = useContext(PresenceContext);
  if (!context) {
    throw new Error(`useUpdatePresence ${PROVIDER_ERROR_MSG}`);
  }
  return context.updatePresence;
};

/**
 * Hook to update cursor position. Trailing-edge throttle so high-frequency
 * mousemove streams collapse to one network update per `throttleMs` window.
 * Pass `throttleMs: 0` to opt out. Pass `null` or `undefined` to clear the
 * cursor.
 *
 * @throws Error if used outside of PresenceProvider
 */
export const useUpdateCursor = (
  throttleMs: number = DEFAULT_CURSOR_THROTTLE_MS,
) => {
  const context = useContext(PresenceContext);
  if (!context) {
    throw new Error(`useUpdateCursor ${PROVIDER_ERROR_MSG}`);
  }
  const { updatePresence } = context;

  return useTrailingEdgeThrottle<CursorPosition | Clear>((cursor) => {
    updatePresence({ cursor: cursor ?? undefined });
  }, throttleMs);
};

/**
 * Hook to update selection range. Trailing-edge throttle so a long drag-select
 * (which fires `selectionchange` every frame) only sends one network update
 * per `throttleMs` window. Pass `throttleMs: 0` to opt out. Pass `null` or
 * `undefined` to clear the selection.
 *
 * @throws Error if used outside of PresenceProvider
 */
export const useUpdateSelection = (
  throttleMs: number = DEFAULT_SELECTION_THROTTLE_MS,
) => {
  const context = useContext(PresenceContext);
  if (!context) {
    throw new Error(`useUpdateSelection ${PROVIDER_ERROR_MSG}`);
  }
  const { updatePresence } = context;

  return useTrailingEdgeThrottle<SelectionRange | Clear>((selection) => {
    updatePresence({ selection: selection ?? undefined });
  }, throttleMs);
};

/**
 * Hook to update pointer position. Pass `null` or `undefined` to clear the
 * pointer. Pointer coordinates are never transformed by document edits.
 *
 * @throws Error if used outside of PresenceProvider
 */
export const useUpdatePointer = (
  throttleMs: number = DEFAULT_POINTER_THROTTLE_MS,
) => {
  const context = useContext(PresenceContext);
  if (!context) {
    throw new Error(`useUpdatePointer ${PROVIDER_ERROR_MSG}`);
  }
  const { updatePointer } = context;

  return useTrailingEdgeThrottle<PointerPosition | Clear>((pointer) => {
    updatePointer(pointer ?? null);
  }, throttleMs);
};
