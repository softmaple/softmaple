/**
 * Presence Context - Provides typed context for presence state
 * Based on docs/design/awareness-and-presence.md
 */

import { createContext } from "react";
import type { PresenceAdapter } from "../adapters/types";
import type { PresenceUser } from "../types/presence";

/**
 * Presence context value type
 */
export interface PresenceContextValue {
  /** Current connection state */
  readonly connectionState:
    | "disconnected"
    | "connecting"
    | "connected"
    | "reconnecting"
    | "error";
  /** Current user's presence (null if not connected) */
  readonly self: PresenceUser | null;
  /** Map of all users' presence (including self) */
  readonly presence: ReadonlyMap<string, PresenceUser>;
  /** List of other users (excluding self) */
  readonly others: ReadonlyArray<PresenceUser>;
  /** Update current user's presence */
  readonly updatePresence: (
    updates: Partial<Omit<PresenceUser, "userId">>,
  ) => void;
  /** Connect to the presence channel */
  readonly connect: () => Promise<void>;
  /** Disconnect from the presence channel */
  readonly disconnect: () => Promise<void>;
  /** The underlying adapter (for advanced use cases) */
  readonly adapter: PresenceAdapter | null;
}

/**
 * Default context value for when provider is not present
 */
const defaultContextValue: PresenceContextValue = {
  connectionState: "disconnected",
  self: null,
  presence: new Map(),
  others: [],
  updatePresence: () => {
    throw new Error(
      "PresenceProvider not found. Wrap your component tree with <PresenceProvider>.",
    );
  },
  connect: () => {
    throw new Error(
      "PresenceProvider not found. Wrap your component tree with <PresenceProvider>.",
    );
  },
  disconnect: () => {
    throw new Error(
      "PresenceProvider not found. Wrap your component tree with <PresenceProvider>.",
    );
  },
  adapter: null,
};

/**
 * React context for presence state
 */
export const PresenceContext =
  createContext<PresenceContextValue>(defaultContextValue);

PresenceContext.displayName = "PresenceContext";
