/**
 * useUpdatePresence hook - Update current user's presence
 */

import { useCallback, useContext } from "react";
import { PresenceContext } from "../providers/presence-context";
import type { CursorPosition, SelectionRange } from "../types/presence";

/**
 * Hook to get the updatePresence function
 * @returns Function to update presence
 */
export const useUpdatePresence = () => {
  const { updatePresence } = useContext(PresenceContext);
  return updatePresence;
};

/**
 * Hook to update cursor position
 * @returns Function to update cursor position
 */
export const useUpdateCursor = () => {
  const { updatePresence } = useContext(PresenceContext);

  return useCallback(
    (cursor: CursorPosition | undefined) => {
      updatePresence({ cursor });
    },
    [updatePresence],
  );
};

/**
 * Hook to update selection range
 * @returns Function to update selection range
 */
export const useUpdateSelection = () => {
  const { updatePresence } = useContext(PresenceContext);

  return useCallback(
    (selection: SelectionRange | undefined) => {
      updatePresence({ selection });
    },
    [updatePresence],
  );
};
