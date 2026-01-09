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
  return context;
};
