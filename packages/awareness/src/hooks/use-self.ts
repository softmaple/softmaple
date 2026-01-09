/**
 * useSelf hook - Access current user's presence
 */

import { useContext } from "react";
import { PresenceContext } from "../providers/presence-context";
import type { PresenceUser } from "../types/presence";

/**
 * Hook to access the current user's presence
 * @returns The current user's presence or null if not connected
 * @throws Error if used outside of PresenceProvider
 */
export const useSelf = (): PresenceUser | null => {
  const context = useContext(PresenceContext);
  if (!context) {
    throw new Error(
      "useSelf must be used within a PresenceProvider. " +
        "Wrap your component tree with <PresenceProvider adapter={adapter}>.",
    );
  }
  return context.self;
};

/**
 * Hook to access a specific property from the current user's presence
 * @param selector - Function to select a property from the presence user
 * @returns The selected property value or undefined if not connected
 * @throws Error if used outside of PresenceProvider
 */
export const useSelfSelector = <T>(
  selector: (self: PresenceUser) => T,
): T | undefined => {
  const context = useContext(PresenceContext);
  if (!context) {
    throw new Error(
      "useSelfSelector must be used within a PresenceProvider. " +
        "Wrap your component tree with <PresenceProvider adapter={adapter}>.",
    );
  }
  if (context.self === null) return undefined;
  return selector(context.self);
};
