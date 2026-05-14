/**
 * No-op presence adapter.
 *
 * Useful for:
 * - SSR rendering (Next.js, React Server Components) where `BroadcastChannel`
 *   and `WebSocket` are not available.
 * - Unit / Storybook tests that mount `PresenceProvider` without a real
 *   transport.
 *
 * The adapter satisfies the full `PresenceAdapter` contract:
 * - `connect()` / `disconnect()` resolve immediately and transition through
 *   the standard connection states so consumers' `useConnectionState` /
 *   `useIsConnected` continue to work.
 * - `getSelf()` returns `null` until `connect()` resolves, after which it
 *   returns the local user only. No other users are ever present.
 * - `updatePresence` / `broadcast` mutate only the local self and notify
 *   subscribers — they never touch the network.
 */

import type { PresenceEvent, PresenceEventPayload } from "../../types/events";
import {
  createPresenceUser,
  type PresenceUser,
  updatePresenceUser,
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

/**
 * Configuration for the no-op adapter. Identical to `AdapterConfig`; named so
 * downstream code can reference a stable type even if extras are added later.
 */
export type NoopAdapterConfig = AdapterConfig;

/**
 * Create a no-op `PresenceAdapter`. Safe to instantiate during SSR.
 */
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

    updatePresence: (updates): void => {
      if (state.self === null) return;
      const updatedSelf = updatePresenceUser(state.self, {
        ...updates,
        lastActiveAt: Date.now(),
      });
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

/**
 * Factory function variant matching `AdapterFactory`.
 */
export const noopAdapterFactory = (
  config: NoopAdapterConfig,
): PresenceAdapter => createNoopAdapter(config);
