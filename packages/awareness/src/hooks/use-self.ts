/**
 * useSelf hook - Access current user's presence
 */

import { useContext } from "react";
import { PresenceContext } from "../providers/presence-context";
import type { PresenceUser } from "../types/presence";

/**
 * Hook to access the current user's presence
 * @returns The current user's presence or null if not connected
 */
export const useSelf = (): PresenceUser | null => {
  const { self } = useContext(PresenceContext);
  return self;
};

/**
 * Hook to access a specific property from the current user's presence
 * @param selector - Function to select a property from the presence user
 * @returns The selected property value or undefined if not connected
 */
export const useSelfSelector = <T>(
  selector: (self: PresenceUser) => T,
): T | undefined => {
  const { self } = useContext(PresenceContext);
  if (self === null) return undefined;
  return selector(self);
};
