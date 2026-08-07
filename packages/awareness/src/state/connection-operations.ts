/**
 * Pure functions for connection state operations
 */

import type { ConnectionStatus, PresenceState } from "../types/state";

/**
 * Set connection status (pure function)
 */
export const setConnectionStatus = (
  state: PresenceState,
  status: ConnectionStatus,
): PresenceState => ({
  ...state,
  connectionStatus: status,
});

/**
 * Check if currently connected (pure function)
 */
export const isConnected = (state: PresenceState): boolean =>
  state.connectionStatus === "connected";

/**
 * Check if currently connecting, authenticating, syncing, or reconnecting
 */
export const isConnecting = (state: PresenceState): boolean =>
  state.connectionStatus === "connecting" ||
  state.connectionStatus === "authenticating" ||
  state.connectionStatus === "syncing" ||
  state.connectionStatus === "reconnecting";

/**
 * Presence session is fully ready (auth + sync complete)
 */
export const isPresenceReady = (state: PresenceState): boolean =>
  state.connectionStatus === "connected";

/**
 * Check if in error state (pure function)
 */
export const hasError = (state: PresenceState): boolean =>
  state.connectionStatus === "error";

/**
 * Check if disconnected (pure function)
 */
export const isDisconnected = (state: PresenceState): boolean =>
  state.connectionStatus === "disconnected";
