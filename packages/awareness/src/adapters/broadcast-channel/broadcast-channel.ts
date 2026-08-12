/**
 * BroadcastChannel adapter for local tab communication
 * Enables presence awareness between tabs in the same browser
 *
 * Heartbeats only advance `lastSeenAt`. Status is derived:
 *   lastSeenAt past offlineTimeout  → remove (offline)
 *   lastActivityAt past idleTimeout → idle
 */

import { withDerivedStatus } from "../../core/status";
import {
  PRESENCE_EVENT,
  type PresenceEvent,
  type PresenceEventPayload,
  type PresenceLeavePayload,
  type PresenceSyncPayload,
} from "../../types/events";
import {
  createConnectionId,
  createPresenceUser,
  markUserActivity,
  type PresenceUser,
  type PresenceUserPatch,
  touchUserSeen,
} from "../../types/presence";
import {
  createInitialState,
  isUserOffline,
  removePresenceUser,
  setPresenceUser,
  updateState,
} from "../adapter-state";
import { createSubscriptionManager } from "../subscription-manager";
import type {
  AdapterConfig,
  AdapterConnectionState,
  PresenceAdapter,
} from "../types";
import {
  BROADCAST_MESSAGE,
  type BroadcastMessage,
  type BroadcastMessageType,
  createBroadcastMessage,
  processBroadcastMessage,
  sendBroadcastMessage,
} from "./broadcast-message";

const BROADCAST_CHANNEL_PREFIX = "softmaple-presence";

const createChannelName = (roomId: string): string =>
  `${BROADCAST_CHANNEL_PREFIX}:${roomId}`;

/**
 * Configuration specific to BroadcastChannel adapter
 */
export interface BroadcastChannelAdapterConfig extends AdapterConfig {
  /** Heartbeat interval in ms (default: 5000) — updates lastSeenAt only */
  readonly heartbeatIntervalMs?: number;
  /**
   * Timeout before considering a peer offline based on lastSeenAt (default: 15000)
   */
  readonly offlineTimeoutMs?: number;
  /**
   * Idle timeout based on lastActivityAt (default: 30000).
   * Independent of offlineTimeout — idle is reachable while heartbeats continue.
   */
  readonly idleTimeoutMs?: number;
  /** Stable connection id for this tab; generated when omitted */
  readonly connectionId?: string;
}

const DEFAULT_HEARTBEAT_INTERVAL_MS = 5000;
const DEFAULT_OFFLINE_TIMEOUT_MS = 15_000;
const DEFAULT_IDLE_TIMEOUT_MS = 30_000;

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

  const connectionId =
    config.connectionId ?? createConnectionId(userInfo.userId);
  const statusTimeouts = { idleTimeoutMs, offlineTimeoutMs };

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

  const sendMessage = (type: BroadcastMessageType, payload: unknown): void => {
    if (state.self === null) return;
    const message = createBroadcastMessage(
      type,
      state.self.connectionId,
      payload,
    );
    sendBroadcastMessage(channel, message, subscriptions.notifyError);
  };

  const handleMessage = (event: MessageEvent<BroadcastMessage>): void => {
    const message = event.data;
    // Suppress only this connection's echoes — other tabs of the same userId
    // must still be visible.
    if (message.senderId === state.self?.connectionId) return;

    state = processBroadcastMessage(
      message,
      state,
      subscriptions,
      (self) => sendMessage(BROADCAST_MESSAGE.SYNC_RESPONSE, self),
      statusTimeouts,
    );
  };

  const sendHeartbeat = (): void => {
    if (state.self === null) return;

    const updatedSelf = touchUserSeen(state.self);
    const withStatus = withDerivedStatus(updatedSelf, statusTimeouts);
    state = updateState(state, {
      self: withStatus,
      presence: setPresenceUser(state.presence, withStatus),
    });
    // Heartbeat is a liveness-only update: lastSeenAt, no activity, no forced active
    sendMessage(BROADCAST_MESSAGE.UPDATE, {
      connectionId: withStatus.connectionId,
      userId: withStatus.userId,
      clock: withStatus.clock,
      updates: { lastSeenAt: withStatus.lastSeenAt },
    });
  };

  const cleanupStaleUsers = (): void => {
    let hasChanges = false;
    let newPresence = state.presence;
    const now = Date.now();

    for (const [sessionId, user] of state.presence) {
      if (sessionId === state.self?.connectionId) {
        const derived = withDerivedStatus(user, statusTimeouts, now);
        if (derived !== user) {
          newPresence = setPresenceUser(newPresence, derived);
          hasChanges = true;
          state = updateState(state, { self: derived });
        }
        continue;
      }

      if (isUserOffline(user, offlineTimeoutMs, now)) {
        newPresence = removePresenceUser(newPresence, sessionId);
        hasChanges = true;

        const leavePayload: PresenceLeavePayload = {
          type: PRESENCE_EVENT.LEAVE,
          connectionId: sessionId,
          userId: user.userId,
        };
        subscriptions.notifyEvent({
          type: PRESENCE_EVENT.LEAVE,
          payload: leavePayload,
          timestamp: now,
        });
      } else {
        const derived = withDerivedStatus(user, statusTimeouts, now);
        if (derived !== user) {
          newPresence = setPresenceUser(newPresence, derived);
          hasChanges = true;
        }
      }
    }

    if (hasChanges) {
      state = updateState(state, { presence: newPresence });
      subscriptions.notifyPresenceChange(state.presence);
    }
  };

  const handleBeforeUnload = (): void => {
    if (state.self === null) return;
    sendMessage(BROADCAST_MESSAGE.LEAVE, {
      connectionId: state.self.connectionId,
      userId: state.self.userId,
    });
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
        channel = new BroadcastChannel(createChannelName(roomId));
        channel.onmessage = handleMessage;

        const self = createPresenceUser({
          connectionId,
          userId: userInfo.userId,
          name: userInfo.name,
          color: userInfo.color,
          avatarUrl: userInfo.avatarUrl,
        });
        state = updateState(state, {
          self,
          presence: setPresenceUser(state.presence, self),
        });

        sendMessage(BROADCAST_MESSAGE.ANNOUNCE, self);
        sendMessage(BROADCAST_MESSAGE.SYNC_REQUEST, null);

        heartbeatTimer = setInterval(sendHeartbeat, heartbeatIntervalMs);
        const cleanupIntervalMs = Math.max(
          1,
          Math.min(offlineTimeoutMs, idleTimeoutMs) / 2,
        );
        cleanupTimer = setInterval(cleanupStaleUsers, cleanupIntervalMs);

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

      state = updateState(state, {
        self: null,
        presence: new Map(),
      });
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

      sendMessage(BROADCAST_MESSAGE.UPDATE, {
        connectionId: updatedSelf.connectionId,
        userId: updatedSelf.userId,
        clock: updatedSelf.clock,
        updates: {
          ...updates,
          lastActivityAt: updatedSelf.lastActivityAt,
          lastSeenAt: updatedSelf.lastSeenAt,
        },
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

      switch (payload.type) {
        case PRESENCE_EVENT.JOIN:
          sendMessage(BROADCAST_MESSAGE.ANNOUNCE, payload.user);
          break;
        case PRESENCE_EVENT.LEAVE:
          sendMessage(BROADCAST_MESSAGE.LEAVE, {
            connectionId: payload.connectionId,
            userId: payload.userId,
          });
          break;
        case PRESENCE_EVENT.UPDATE:
          sendMessage(BROADCAST_MESSAGE.UPDATE, {
            connectionId: payload.connectionId,
            userId: payload.userId,
            clock: payload.clock,
            updates: payload.updates,
          });
          break;
        case PRESENCE_EVENT.SYNC: {
          const syncPayload = payload as PresenceSyncPayload;
          for (const user of syncPayload.users) {
            sendMessage(BROADCAST_MESSAGE.SYNC_RESPONSE, user);
          }
          break;
        }
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

    getPresence: (): ReadonlyMap<string, PresenceUser> =>
      new Map(state.presence),

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
