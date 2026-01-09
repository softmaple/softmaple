/**
 * usePresence hook - Access presence state from context
 */

import { useContext } from "react";
import {
  PresenceContext,
  type PresenceContextValue,
} from "../providers/presence-context";

/**
 * Hook to access the full presence context
 * @returns The presence context value
 * @throws Error if used outside of PresenceProvider
 */
export const usePresence = (): PresenceContextValue => {
  const context = useContext(PresenceContext);

  if (!context) {
    throw new Error(
      "usePresence must be used within a PresenceProvider. " +
        "Wrap your component tree with <PresenceProvider adapter={adapter}>.",
    );
  }

  return context;
};
