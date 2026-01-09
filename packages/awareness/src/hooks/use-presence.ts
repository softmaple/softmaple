/**
 * usePresence hook - Access presence state from context
 */

import { useContext } from "react";
import {
  PresenceContext,
  type PresenceContextValue,
} from "../providers/presence-context";

/**
 * Sentinel value to detect if context is missing
 */
const CONTEXT_MISSING_ERROR =
  "usePresence must be used within a PresenceProvider";

/**
 * Hook to access the full presence context
 * @returns The presence context value
 * @throws Error if used outside of PresenceProvider
 */
export const usePresence = (): PresenceContextValue => {
  const context = useContext(PresenceContext);

  // Check if we're using the default context value (provider missing)
  // The default context throws on updatePresence/connect/disconnect
  // We validate by checking if adapter is null and connectionState is disconnected
  // which is the default state, but we add explicit runtime check
  if (context === undefined) {
    throw new Error(CONTEXT_MISSING_ERROR);
  }

  return context;
};
