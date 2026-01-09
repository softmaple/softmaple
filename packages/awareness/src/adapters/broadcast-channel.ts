/**
 * BroadcastChannel adapter for local tab communication
 * Enables presence awareness between tabs in the same browser
 */

import type {
  PresenceEvent,
  PresenceEventPayload,
  PresenceLeavePayload,
  PresenceSyncPayload,
} from "../types/events";
import {
  createPresenceUser,
  type PresenceUser,
  updatePresenceUser,
} from "../types/presence";
import {
  createInitialState,
  isUserIdle,
  isUserOffline,
  removePresenceUser,
  setPresenceUser,
  updateState,
} from "./adapter-state";
import {
  type BroadcastMessage,
  createBroadcastMessage,
  processBroadcastMessage,
  sendBroadcastMessage,
} from "./broadcast-message";
import { createSubscriptionManager } from "./subscription-manager";
import type {
  AdapterConfig,
  AdapterConnectionState,
  PresenceAdapter,
} from "./types";

/**
 * Configuration specific to BroadcastChannel adapter
 */
export interface BroadcastChannelAdapterConfig extends AdapterConfig {
  /** Heartbeat interval in ms (default: 5000) */
  readonly heartbeatIntervalMs?: number;
  /** Timeout before considering user offline (default: 15000) */
  readonly offlineTimeoutMs?: number;
  /** Idle timeout in ms (default: 30000) */
  readonly idleTimeoutMs?: number;
}

const DEFAULT_HEARTBEAT_INTERVAL_MS = 5000;
const DEFAULT_OFFLINE_TIMEOUT_MS = 15000;
const DEFAULT_IDLE_TIMEOUT_MS = 30000;

/**
 * Create a BroadcastChannel adapter instance
 */
export const createBroadcastChannelAdapter = (
  config: BroadcastChannelAdapterConfig,
): PresenceAdapter => {
  const {
    roomId,
    userInfo,
    heartbeatIntervalMs = DEFAULT_HEARTBEAT_INTERVAL_MS,
    offlineTimeoutMs = DEFAULT_OFFLINE_TIMEOUT_MS,
    idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS,
  } = config;

  let state = createInitialState();
  let channel: BroadcastChannel | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let cleanupTimer: ReturnType<typeof setInterval> | null = null;

  const subscriptions = createSubscriptionManager();

  const setConnectionState = (newState: AdapterConnectionState): void => {
    if (state.connectionState !== newState) {
      state = updateState(state, { connectionState: newState });
      subscriptions.notifyConnectionChange(newState);
    }
  };

  const sendMessage = (
    type: BroadcastMessage["type"],
    payload: unknown,
  ): void => {
    if (state.self === null) return;
    const message = createBroadcastMessage(type, state.self.userId, payload);
    sendBroadcastMessage(channel, message, subscriptions.notifyError);
  };

  const handleMessage = (event: MessageEvent<BroadcastMessage>): void => {
    const message = event.data;
    if (message.senderId === state.self?.userId) return;

    state = processBroadcastMessage(message, state, subscriptions, (self) =>
      sendMessage("presence:sync-response", self),
    );
  };

  const sendHeartbeat = (): void => {
    if (state.self === null) return;

    const updatedSelf = updatePresenceUser(state.self, {
      status: "active",
      lastActiveAt: Date.now(),
    });
    state = updateState(state, { self: updatedSelf });
    sendMessage("presence:update", {
      userId: updatedSelf.userId,
      updates: { status: "active", lastActiveAt: updatedSelf.lastActiveAt },
    });
  };

  const cleanupStaleUsers = (): void => {
    let hasChanges = false;
    let newPresence = state.presence;

    for (const [userId, user] of state.presence) {
      if (isUserOffline(user, offlineTimeoutMs)) {
        newPresence = removePresenceUser(newPresence, userId);
        hasChanges = true;

        const leavePayload: PresenceLeavePayload = {
          type: "presence:leave",
          userId,
        };
        subscriptions.notifyEvent({
          type: "presence:leave",
          payload: leavePayload,
          timestamp: Date.now(),
        });
      } else if (isUserIdle(user, idleTimeoutMs) && user.status !== "idle") {
        const updatedUser = updatePresenceUser(user, { status: "idle" });
        newPresence = setPresenceUser(newPresence, updatedUser);
        hasChanges = true;
      }
    }

    if (hasChanges) {
      state = updateState(state, { presence: newPresence });
      subscriptions.notifyPresenceChange(newPresence);
    }
  };

  const handleBeforeUnload = (): void => {
    if (state.self !== null) {
      sendMessage("presence:leave", state.self.userId);
    }
  };

  const adapter: PresenceAdapter = {
    connect: async (): Promise<void> => {
      if (state.connectionState === "connected") return;

      setConnectionState("connecting");

      try {
        if (typeof BroadcastChannel === "undefined") {
          throw new Error(
            "BroadcastChannel is not supported in this environment",
          );
        }

        channel = new BroadcastChannel(`softmaple-presence:${roomId}`);
        channel.onmessage = handleMessage;

        const self = createPresenceUser(
          userInfo.userId,
          userInfo.name,
          userInfo.color,
          { avatarUrl: userInfo.avatarUrl },
        );
        state = updateState(state, {
          self,
          presence: setPresenceUser(state.presence, self),
        });

        sendMessage("presence:announce", self);
        sendMessage("presence:sync-request", null);

        heartbeatTimer = setInterval(sendHeartbeat, heartbeatIntervalMs);
        cleanupTimer = setInterval(cleanupStaleUsers, offlineTimeoutMs / 2);

        if (typeof window !== "undefined") {
          window.addEventListener("beforeunload", handleBeforeUnload);
        }

        setConnectionState("connected");
      } catch (error) {
        setConnectionState("error");
        subscriptions.notifyError(
          error instanceof Error
            ? error
            : new Error("Failed to connect to BroadcastChannel"),
        );
        throw error;
      }
    },

    disconnect: async (): Promise<void> => {
      if (state.connectionState === "disconnected") return;

      handleBeforeUnload();

      if (heartbeatTimer !== null) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
      if (cleanupTimer !== null) {
        clearInterval(cleanupTimer);
        cleanupTimer = null;
      }

      if (typeof window !== "undefined") {
        window.removeEventListener("beforeunload", handleBeforeUnload);
      }

      if (channel !== null) {
        channel.close();
        channel = null;
      }

      state = createInitialState();
      setConnectionState("disconnected");
    },

    getConnectionState: (): AdapterConnectionState => state.connectionState,

    updatePresence: (updates: Partial<Omit<PresenceUser, "userId">>): void => {
      if (state.self === null) return;

      const updatedSelf = updatePresenceUser(state.self, {
        ...updates,
        lastActiveAt: Date.now(),
      });
      state = updateState(state, {
        self: updatedSelf,
        presence: setPresenceUser(state.presence, updatedSelf),
      });

      sendMessage("presence:update", {
        userId: updatedSelf.userId,
        updates: { ...updates, lastActiveAt: updatedSelf.lastActiveAt },
      });

      subscriptions.notifyPresenceChange(state.presence);
    },

    broadcast: (payload: PresenceEventPayload): void => {
      if (state.self === null) return;

      const event: PresenceEvent = {
        type: payload.type,
        payload,
        timestamp: Date.now(),
      };

      if (payload.type === "presence:sync") {
        const syncPayload = payload as PresenceSyncPayload;
        sendMessage("presence:sync-response", syncPayload.users[0]);
      }

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

    getPresence: (): ReadonlyMap<string, PresenceUser> => state.presence,

    getSelf: (): PresenceUser | null => state.self,
  };

  return adapter;
};

/**
 * Factory function for creating BroadcastChannel adapters
 */
export const broadcastChannelAdapterFactory = (
  config: BroadcastChannelAdapterConfig,
): PresenceAdapter => createBroadcastChannelAdapter(config);
