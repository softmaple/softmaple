/**
 * Subscription management for presence adapters
 * Handles callback registration and notification
 */

import type { PresenceEvent } from "../types/events";
import type { PresenceUser } from "../types/presence";
import type {
  AdapterConnectionState,
  ConnectionCallback,
  ErrorCallback,
  EventCallback,
  PresenceCallback,
  Unsubscribe,
} from "./types";

/**
 * Manages callback subscriptions for an adapter
 */
export interface SubscriptionManager {
  readonly notifyPresenceChange: (
    presence: ReadonlyMap<string, PresenceUser>,
  ) => void;
  readonly notifyEvent: (event: PresenceEvent) => void;
  readonly notifyConnectionChange: (state: AdapterConnectionState) => void;
  readonly notifyError: (error: Error) => void;
  readonly onPresenceChange: (callback: PresenceCallback) => Unsubscribe;
  readonly onEvent: (callback: EventCallback) => Unsubscribe;
  readonly onConnectionChange: (callback: ConnectionCallback) => Unsubscribe;
  readonly onError: (callback: ErrorCallback) => Unsubscribe;
}

/**
 * Create a subscription manager instance
 */
export const createSubscriptionManager = (): SubscriptionManager => {
  const presenceCallbacks = new Set<PresenceCallback>();
  const eventCallbacks = new Set<EventCallback>();
  const connectionCallbacks = new Set<ConnectionCallback>();
  const errorCallbacks = new Set<ErrorCallback>();

  const notifyPresenceChange = (
    presence: ReadonlyMap<string, PresenceUser>,
  ): void => {
    presenceCallbacks.forEach((callback) => {
      callback(presence);
    });
  };

  const notifyEvent = (event: PresenceEvent): void => {
    eventCallbacks.forEach((callback) => {
      callback(event);
    });
  };

  const notifyConnectionChange = (state: AdapterConnectionState): void => {
    connectionCallbacks.forEach((callback) => {
      callback(state);
    });
  };

  const notifyError = (error: Error): void => {
    errorCallbacks.forEach((callback) => {
      callback(error);
    });
  };

  const onPresenceChange = (callback: PresenceCallback): Unsubscribe => {
    presenceCallbacks.add(callback);
    return () => presenceCallbacks.delete(callback);
  };

  const onEvent = (callback: EventCallback): Unsubscribe => {
    eventCallbacks.add(callback);
    return () => eventCallbacks.delete(callback);
  };

  const onConnectionChange = (callback: ConnectionCallback): Unsubscribe => {
    connectionCallbacks.add(callback);
    return () => connectionCallbacks.delete(callback);
  };

  const onError = (callback: ErrorCallback): Unsubscribe => {
    errorCallbacks.add(callback);
    return () => errorCallbacks.delete(callback);
  };

  return {
    notifyPresenceChange,
    notifyEvent,
    notifyConnectionChange,
    notifyError,
    onPresenceChange,
    onEvent,
    onConnectionChange,
    onError,
  };
};
