/**
 * No-op presence adapter.
 *
 * Useful for SSR, unit tests, and Storybook. Maintains the full state machine
 * without touching the network.
 */

import type { PresenceEvent, PresenceEventPayload } from "../../types/events";
import {
  createPresenceUser,
  markUserActivity,
  type PresenceUser,
  type PresenceUserPatch,
} from "../../types/presence";
import {
  createInitialState,
  setPresenceUser,
  updateState,
} from "../adapter-state";
import { createSubscriptionManager } from "../subscription-manager";
import type {
  AdapterConfig,
  AdapterConnectionState,
  PresenceAdapter,
} from "../types";

export type NoopAdapterConfig = AdapterConfig;

export const createNoopAdapter = (
  config: NoopAdapterConfig,
): PresenceAdapter => {
  let state = createInitialState();
  const subscriptions = createSubscriptionManager();

  const setConnectionState = (next: AdapterConnectionState): void => {
    if (state.connectionState === next) return;
    state = updateState(state, { connectionState: next });
    subscriptions.notifyConnectionChange(next);
  };

  const adapter: PresenceAdapter = {
    connect: async (): Promise<void> => {
      if (state.connectionState === "connected") return;

      setConnectionState("connecting");

      const self = createPresenceUser({
        userId: config.userInfo.userId,
        name: config.userInfo.name,
        color: config.userInfo.color,
        avatarUrl: config.userInfo.avatarUrl,
      });

      state = updateState(state, {
        self,
        presence: setPresenceUser(state.presence, self),
      });
      subscriptions.notifyPresenceChange(state.presence);
      setConnectionState("connected");
    },

    disconnect: async (): Promise<void> => {
      if (state.connectionState === "disconnected") return;
      state = updateState(state, { self: null, presence: new Map() });
      subscriptions.notifyPresenceChange(state.presence);
      setConnectionState("disconnected");
    },

    getConnectionState: (): AdapterConnectionState => state.connectionState,

    updatePresence: (updates: PresenceUserPatch): void => {
      if (state.self === null) return;
      const updatedSelf = markUserActivity(state.self, Date.now(), updates);
      state = updateState(state, {
        self: updatedSelf,
        presence: setPresenceUser(state.presence, updatedSelf),
      });
      subscriptions.notifyPresenceChange(state.presence);
    },

    broadcast: (payload: PresenceEventPayload): void => {
      const event: PresenceEvent = {
        type: payload.type,
        payload,
        timestamp: Date.now(),
      };
      subscriptions.notifyEvent(event);
    },

    onPresenceChange: (callback) => {
      const unsubscribe = subscriptions.onPresenceChange(callback);
      callback(state.presence);
      return unsubscribe;
    },

    onEvent: subscriptions.onEvent,

    onConnectionChange: (callback) => {
      const unsubscribe = subscriptions.onConnectionChange(callback);
      callback(state.connectionState);
      return unsubscribe;
    },

    onError: subscriptions.onError,

    getPresence: (): ReadonlyMap<string, PresenceUser> =>
      new Map(state.presence),

    getSelf: (): PresenceUser | null => state.self,
  };

  return adapter;
};

export const noopAdapterFactory = (
  config: NoopAdapterConfig,
): PresenceAdapter => createNoopAdapter(config);
