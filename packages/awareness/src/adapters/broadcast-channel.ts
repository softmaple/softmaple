/**
 * BroadcastChannel adapter for local tab communication
 * Enables presence awareness between tabs in the same browser
 */

import type {
  PresenceEvent,
  PresenceEventPayload,
  PresenceJoinPayload,
  PresenceLeavePayload,
  PresenceSyncPayload,
  PresenceUpdatePayload,
} from "../types/events";
import {
  createPresenceUser,
  type PresenceUser,
  updatePresenceUser,
} from "../types/presence";
import type {
  AdapterConfig,
  AdapterConnectionState,
  ConnectionCallback,
  ErrorCallback,
  EventCallback,
  PresenceAdapter,
  PresenceCallback,
  Unsubscribe,
} from "./types";

/**
 * Internal message types for BroadcastChannel communication
 */
type BroadcastMessageType =
  | "presence:announce"
  | "presence:sync-request"
  | "presence:sync-response"
  | "presence:update"
  | "presence:leave";

interface BroadcastMessage {
  readonly type: BroadcastMessageType;
  readonly senderId: string;
  readonly timestamp: number;
  readonly payload: unknown;
}

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

/**
 * Default configuration values
 */
const DEFAULT_HEARTBEAT_INTERVAL_MS = 5000;
const DEFAULT_OFFLINE_TIMEOUT_MS = 15000;
const DEFAULT_IDLE_TIMEOUT_MS = 30000;

/**
 * Immutable state container for the adapter
 */
interface AdapterState {
  readonly connectionState: AdapterConnectionState;
  readonly presence: ReadonlyMap<string, PresenceUser>;
  readonly self: PresenceUser | null;
}

/**
 * Create initial adapter state
 */
const createInitialState = (): AdapterState => ({
  connectionState: "disconnected",
  presence: new Map(),
  self: null,
});

/**
 * Update state immutably
 */
const updateState = (
  state: AdapterState,
  updates: Partial<AdapterState>,
): AdapterState => ({
  ...state,
  ...updates,
});

/**
 * Add or update user in presence map immutably
 */
const setPresenceUser = (
  presence: ReadonlyMap<string, PresenceUser>,
  user: PresenceUser,
): ReadonlyMap<string, PresenceUser> => {
  const newMap = new Map(presence);
  newMap.set(user.userId, user);
  return newMap;
};

/**
 * Remove user from presence map immutably
 */
const removePresenceUser = (
  presence: ReadonlyMap<string, PresenceUser>,
  userId: string,
): ReadonlyMap<string, PresenceUser> => {
  const newMap = new Map(presence);
  newMap.delete(userId);
  return newMap;
};

/**
 * Check if user should be considered offline based on last activity
 */
const isUserOffline = (user: PresenceUser, timeoutMs: number): boolean =>
  Date.now() - user.lastActiveAt > timeoutMs;

/**
 * Check if user should be considered idle
 */
const isUserIdle = (user: PresenceUser, idleTimeoutMs: number): boolean =>
  Date.now() - user.lastActiveAt > idleTimeoutMs;

/**
 * BroadcastChannel adapter for local tab communication
 * Implements the PresenceAdapter interface
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

  // Mutable internal state (encapsulated)
  let state = createInitialState();
  let channel: BroadcastChannel | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let cleanupTimer: ReturnType<typeof setInterval> | null = null;

  // Callback subscriptions
  const presenceCallbacks = new Set<PresenceCallback>();
  const eventCallbacks = new Set<EventCallback>();
  const connectionCallbacks = new Set<ConnectionCallback>();
  const errorCallbacks = new Set<ErrorCallback>();

  /**
   * Notify all presence subscribers
   */
  const notifyPresenceChange = (): void => {
    const presence = state.presence;
    presenceCallbacks.forEach((callback) => {
      callback(presence);
    });
  };

  /**
   * Notify all event subscribers
   */
  const notifyEvent = (event: PresenceEvent): void => {
    eventCallbacks.forEach((callback) => {
      callback(event);
    });
  };

  /**
   * Notify all connection subscribers
   */
  const notifyConnectionChange = (): void => {
    const connectionState = state.connectionState;
    connectionCallbacks.forEach((callback) => {
      callback(connectionState);
    });
  };

  /**
   * Notify all error subscribers
   */
  const notifyError = (error: Error): void => {
    errorCallbacks.forEach((callback) => {
      callback(error);
    });
  };

  /**
   * Update connection state and notify
   */
  const setConnectionState = (newState: AdapterConnectionState): void => {
    if (state.connectionState !== newState) {
      state = updateState(state, { connectionState: newState });
      notifyConnectionChange();
    }
  };

  /**
   * Send a message through the BroadcastChannel
   */
  const sendMessage = (type: BroadcastMessageType, payload: unknown): void => {
    if (channel === null || state.self === null) return;

    const message: BroadcastMessage = {
      type,
      senderId: state.self.userId,
      timestamp: Date.now(),
      payload,
    };

    try {
      channel.postMessage(message);
    } catch (error) {
      notifyError(
        error instanceof Error
          ? error
          : new Error("Failed to send broadcast message"),
      );
    }
  };

  /**
   * Handle incoming broadcast messages
   */
  const handleMessage = (event: MessageEvent<BroadcastMessage>): void => {
    const message = event.data;

    // Ignore messages from self
    if (message.senderId === state.self?.userId) return;

    switch (message.type) {
      case "presence:announce": {
        const user = message.payload as PresenceUser;
        state = updateState(state, {
          presence: setPresenceUser(state.presence, user),
        });
        notifyPresenceChange();

        const joinPayload: PresenceJoinPayload = {
          type: "presence:join",
          user,
        };
        notifyEvent({
          type: "presence:join",
          payload: joinPayload,
          timestamp: message.timestamp,
        });

        // Respond with our presence
        if (state.self !== null) {
          sendMessage("presence:sync-response", state.self);
        }
        break;
      }

      case "presence:sync-request": {
        // Respond with our presence
        if (state.self !== null) {
          sendMessage("presence:sync-response", state.self);
        }
        break;
      }

      case "presence:sync-response": {
        const user = message.payload as PresenceUser;
        state = updateState(state, {
          presence: setPresenceUser(state.presence, user),
        });
        notifyPresenceChange();
        break;
      }

      case "presence:update": {
        const updates = message.payload as {
          userId: string;
          updates: Partial<PresenceUser>;
        };
        const existingUser = state.presence.get(updates.userId);
        if (existingUser !== undefined) {
          const updatedUser = updatePresenceUser(existingUser, updates.updates);
          state = updateState(state, {
            presence: setPresenceUser(state.presence, updatedUser),
          });
          notifyPresenceChange();

          const updatePayload: PresenceUpdatePayload = {
            type: "presence:update",
            userId: updates.userId,
            updates: updates.updates,
          };
          notifyEvent({
            type: "presence:update",
            payload: updatePayload,
            timestamp: message.timestamp,
          });
        }
        break;
      }

      case "presence:leave": {
        const userId = message.payload as string;
        if (state.presence.has(userId)) {
          state = updateState(state, {
            presence: removePresenceUser(state.presence, userId),
          });
          notifyPresenceChange();

          const leavePayload: PresenceLeavePayload = {
            type: "presence:leave",
            userId,
          };
          notifyEvent({
            type: "presence:leave",
            payload: leavePayload,
            timestamp: message.timestamp,
          });
        }
        break;
      }
    }
  };

  /**
   * Send heartbeat to keep presence alive
   */
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

  /**
   * Clean up stale/offline users
   */
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
        notifyEvent({
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
      notifyPresenceChange();
    }
  };

  /**
   * Handle page unload - notify others of leaving
   */
  const handleBeforeUnload = (): void => {
    if (state.self !== null) {
      sendMessage("presence:leave", state.self.userId);
    }
  };

  // Public API implementation
  const adapter: PresenceAdapter = {
    connect: async (): Promise<void> => {
      if (state.connectionState === "connected") return;

      setConnectionState("connecting");

      try {
        // Check if BroadcastChannel is available
        if (typeof BroadcastChannel === "undefined") {
          throw new Error(
            "BroadcastChannel is not supported in this environment",
          );
        }

        // Create channel
        const channelName = `softmaple-presence:${roomId}`;
        channel = new BroadcastChannel(channelName);
        channel.onmessage = handleMessage;

        // Create self presence
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

        // Announce presence to other tabs
        sendMessage("presence:announce", self);

        // Request sync from other tabs
        sendMessage("presence:sync-request", null);

        // Start heartbeat
        heartbeatTimer = setInterval(sendHeartbeat, heartbeatIntervalMs);

        // Start cleanup timer
        cleanupTimer = setInterval(cleanupStaleUsers, offlineTimeoutMs / 2);

        // Listen for page unload
        if (typeof window !== "undefined") {
          window.addEventListener("beforeunload", handleBeforeUnload);
        }

        setConnectionState("connected");
      } catch (error) {
        setConnectionState("error");
        notifyError(
          error instanceof Error
            ? error
            : new Error("Failed to connect to BroadcastChannel"),
        );
        throw error;
      }
    },

    disconnect: async (): Promise<void> => {
      if (state.connectionState === "disconnected") return;

      // Notify others of leaving
      handleBeforeUnload();

      // Clear timers
      if (heartbeatTimer !== null) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
      if (cleanupTimer !== null) {
        clearInterval(cleanupTimer);
        cleanupTimer = null;
      }

      // Remove event listener
      if (typeof window !== "undefined") {
        window.removeEventListener("beforeunload", handleBeforeUnload);
      }

      // Close channel
      if (channel !== null) {
        channel.close();
        channel = null;
      }

      // Reset state
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

      notifyPresenceChange();
    },

    broadcast: (payload: PresenceEventPayload): void => {
      if (state.self === null) return;

      const event: PresenceEvent = {
        type: payload.type,
        payload,
        timestamp: Date.now(),
      };

      // For sync events, broadcast to other tabs
      if (payload.type === "presence:sync") {
        const syncPayload = payload as PresenceSyncPayload;
        sendMessage("presence:sync-response", syncPayload.users[0]);
      }

      notifyEvent(event);
    },

    onPresenceChange: (callback: PresenceCallback): Unsubscribe => {
      presenceCallbacks.add(callback);
      // Immediately call with current state
      callback(state.presence);
      return () => presenceCallbacks.delete(callback);
    },

    onEvent: (callback: EventCallback): Unsubscribe => {
      eventCallbacks.add(callback);
      return () => eventCallbacks.delete(callback);
    },

    onConnectionChange: (callback: ConnectionCallback): Unsubscribe => {
      connectionCallbacks.add(callback);
      // Immediately call with current state
      callback(state.connectionState);
      return () => connectionCallbacks.delete(callback);
    },

    onError: (callback: ErrorCallback): Unsubscribe => {
      errorCallbacks.add(callback);
      return () => errorCallbacks.delete(callback);
    },

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
