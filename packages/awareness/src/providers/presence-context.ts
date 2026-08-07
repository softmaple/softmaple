/**
 * Presence Context - Provides typed context for presence state
 * Based on docs/design/awareness-and-presence.md
 */

import { createContext } from "react";
import type {
  AdapterConnectionState,
  PresenceAdapter,
} from "../adapters/types";
import type { ActivityEvent } from "../types/events";
import type { PresenceUser, PresenceUserPatch } from "../types/presence";

/**
 * Presence context value type
 */
export interface PresenceContextValue {
  /** Current connection state */
  readonly connectionState: AdapterConnectionState;
  /** Current user's presence (null if not connected) */
  readonly self: PresenceUser | null;
  /** Map of all sessions' presence keyed by connectionId (including self) */
  readonly presence: ReadonlyMap<string, PresenceUser>;
  /** List of other sessions (excluding self connection) */
  readonly others: ReadonlyArray<PresenceUser>;
  /** Recent activity events (bounded list, most recent first) */
  readonly recentActivity: ReadonlyArray<ActivityEvent>;
  /** Update current user's presence (marks activity) */
  readonly updatePresence: (updates: PresenceUserPatch) => void;
  /** Connect to the presence channel (resolves when presence-ready) */
  readonly connect: () => Promise<void>;
  /** Disconnect from the presence channel */
  readonly disconnect: () => Promise<void>;
  /** The underlying adapter (for advanced use cases) */
  readonly adapter: PresenceAdapter | null;
}

/**
 * React context for presence state
 * Default is null to detect missing provider
 */
export const PresenceContext = createContext<PresenceContextValue | null>(null);

PresenceContext.displayName = "PresenceContext";
