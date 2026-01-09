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
 * Check if currently connecting or reconnecting (pure function)
 */
export const isConnecting = (state: PresenceState): boolean =>
  state.connectionStatus === "connecting" ||
  state.connectionStatus === "reconnecting";

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
