/**
 * useUpdatePresence hook - Update current user's presence
 */

import { useCallback, useContext } from "react";
import { PresenceContext } from "../providers/presence-context";
import type { CursorPosition, SelectionRange } from "../types/presence";

const PROVIDER_ERROR_MSG =
  "must be used within a PresenceProvider. " +
  "Wrap your component tree with <PresenceProvider adapter={adapter}>.";

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
 * Hook to update cursor position
 * @returns Function to update cursor position
 * @throws Error if used outside of PresenceProvider
 */
export const useUpdateCursor = () => {
  const context = useContext(PresenceContext);
  if (!context) {
    throw new Error(`useUpdateCursor ${PROVIDER_ERROR_MSG}`);
  }
  const { updatePresence } = context;

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
 * @throws Error if used outside of PresenceProvider
 */
export const useUpdateSelection = () => {
  const context = useContext(PresenceContext);
  if (!context) {
    throw new Error(`useUpdateSelection ${PROVIDER_ERROR_MSG}`);
  }
  const { updatePresence } = context;

  return useCallback(
    (selection: SelectionRange | undefined) => {
      updatePresence({ selection });
    },
    [updatePresence],
  );
};

/**
 * Hook to update typing status
 * @returns Function to update typing status
 * @throws Error if used outside of PresenceProvider
 */
export const useUpdateTyping = () => {
  const context = useContext(PresenceContext);
  if (!context) {
    throw new Error(`useUpdateTyping ${PROVIDER_ERROR_MSG}`);
  }
  const { self, updatePresence } = context;

  return useCallback(
    (isTyping: boolean) => {
      updatePresence({
        meta: {
          ...self?.meta,
          isTyping,
        },
      });
    },
    [self?.meta, updatePresence],
  );
};
