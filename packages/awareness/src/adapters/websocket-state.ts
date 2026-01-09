/**
 * WebSocket adapter internal state management
 */

import type { AdapterState } from "./adapter-state";
import { createInitialState, updateState } from "./adapter-state";
import type { SubscriptionManager } from "./subscription-manager";
import type { ReconnectConfig, ReconnectState } from "./websocket-types";
import { createReconnectState } from "./websocket-types";

/**
 * Internal mutable state for WebSocket adapter
 */
export interface InternalState {
  socket: WebSocket | null;
  state: AdapterState;
  reconnect: ReconnectState;
  heartbeatIntervalId: ReturnType<typeof setInterval> | null;
  connectionTimeoutId: ReturnType<typeof setTimeout> | null;
}

/**
 * Create initial internal state
 */
export const createInternalState = (
  reconnectConfig: ReconnectConfig,
): InternalState => ({
  socket: null,
  state: createInitialState(),
  reconnect: createReconnectState(reconnectConfig),
  heartbeatIntervalId: null,
  connectionTimeoutId: null,
});

/**
 * Update internal state and notify subscribers
 */
export const updateInternalState = (
  internal: InternalState,
  updates: Partial<AdapterState>,
  subscriptions: SubscriptionManager,
  notifyPresence = false,
): InternalState => {
  const newState = updateState(internal.state, updates);
  const result = { ...internal, state: newState };

  if (updates.connectionState !== undefined) {
    subscriptions.notifyConnectionChange(updates.connectionState);
  }
  if (notifyPresence) {
    subscriptions.notifyPresenceChange(newState.presence);
  }

  return result;
};

/**
 * Reset internal state to initial values
 */
export const resetInternalState = (
  internal: InternalState,
  reconnectConfig: ReconnectConfig,
): InternalState => ({
  ...internal,
  socket: null,
  state: createInitialState(),
  reconnect: createReconnectState(reconnectConfig),
});
