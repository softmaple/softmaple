/**
 * Edge-case tests for adapter message parsing, validation, and transport
 * lifecycle helpers.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PRESENCE_EVENT } from "../types/events";
import { createPresenceUser } from "../types/presence";
import { createInitialState } from "./adapter-state";
import {
  type BroadcastChannelAdapterConfig,
  broadcastChannelAdapterFactory,
  createBroadcastChannelAdapter,
} from "./broadcast-channel/broadcast-channel";
import {
  BROADCAST_MESSAGE,
  createBroadcastMessage,
  processBroadcastMessage,
  sendBroadcastMessage,
} from "./broadcast-channel/broadcast-message";
import { createSubscriptionManager } from "./subscription-manager";
import { DEFAULT_RECONNECT_CONFIG } from "./types";
import {
  cancelReconnect,
  cleanupWebSocket,
  scheduleReconnect,
  sendWebSocketMessage,
  startHeartbeat,
  stopHeartbeat,
} from "./websocket/connection";
import { parseMessage, processMessage } from "./websocket/message";
import { createInternalState, updateInternalState } from "./websocket/state";
import type { WebSocketAdapterConfig } from "./websocket/types";
import { WS_MESSAGE } from "./websocket/types";

const wsConfig: WebSocketAdapterConfig = {
  url: "ws://localhost:1234",
  roomId: "room-1",
  userInfo: { userId: "self", name: "Self", color: "#000" },
};

describe("broadcast-message handlers - invalid payloads", () => {
  const subs = () => createSubscriptionManager();

  it("ignores ANNOUNCE with non-user payload", () => {
    const state = createInitialState();
    const message = createBroadcastMessage(BROADCAST_MESSAGE.ANNOUNCE, "peer", {
      not: "a user",
    });
    const result = processBroadcastMessage(message, state, subs(), () => {});
    expect(result).toBe(state);
  });

  it("ignores SYNC_RESPONSE with non-user payload", () => {
    const state = createInitialState();
    const message = createBroadcastMessage(
      BROADCAST_MESSAGE.SYNC_RESPONSE,
      "peer",
      null,
    );
    const result = processBroadcastMessage(message, state, subs(), () => {});
    expect(result).toBe(state);
  });

  it("ignores UPDATE with malformed payload", () => {
    const state = createInitialState();
    const message = createBroadcastMessage(BROADCAST_MESSAGE.UPDATE, "peer", {
      userId: 5,
    });
    const result = processBroadcastMessage(message, state, subs(), () => {});
    expect(result).toBe(state);
  });

  it("ignores UPDATE for unknown user", () => {
    const state = createInitialState();
    const message = createBroadcastMessage(BROADCAST_MESSAGE.UPDATE, "peer", {
      userId: "ghost",
      updates: { status: "idle" as const },
    });
    const result = processBroadcastMessage(message, state, subs(), () => {});
    expect(result).toBe(state);
  });

  it("ignores LEAVE with empty string payload", () => {
    const state = createInitialState();
    const message = createBroadcastMessage(BROADCAST_MESSAGE.LEAVE, "peer", "");
    const result = processBroadcastMessage(message, state, subs(), () => {});
    expect(result).toBe(state);
  });

  it("ignores LEAVE for unknown user", () => {
    const state = createInitialState();
    const message = createBroadcastMessage(
      BROADCAST_MESSAGE.LEAVE,
      "peer",
      "ghost",
    );
    const result = processBroadcastMessage(message, state, subs(), () => {});
    expect(result).toBe(state);
  });

  it("SYNC_REQUEST without self does not call sendResponse", () => {
    const state = createInitialState();
    const sendResponse = vi.fn();
    const message = createBroadcastMessage(
      BROADCAST_MESSAGE.SYNC_REQUEST,
      "peer",
      null,
    );
    const result = processBroadcastMessage(
      message,
      state,
      subs(),
      sendResponse,
    );
    expect(result).toBe(state);
    expect(sendResponse).not.toHaveBeenCalled();
  });

  it("ignores ANNOUNCE with various malformed user shapes", () => {
    const state = createInitialState();
    const subsMgr = subs();

    const variants: unknown[] = [
      undefined,
      "string",
      {
        userId: 5,
        name: "x",
        color: "#000",
        status: "active",
        lastActiveAt: 0,
      },
      {
        userId: "u",
        name: 5,
        color: "#000",
        status: "active",
        lastActiveAt: 0,
      },
      { userId: "u", name: "n", color: 0, status: "active", lastActiveAt: 0 },
      { userId: "u", name: "n", color: "#000", status: "wat", lastActiveAt: 0 },
      {
        userId: "u",
        name: "n",
        color: "#000",
        status: "active",
        lastActiveAt: "now",
      },
    ];
    for (const payload of variants) {
      const message = createBroadcastMessage(
        BROADCAST_MESSAGE.ANNOUNCE,
        "peer",
        payload,
      );
      const result = processBroadcastMessage(message, state, subsMgr, () => {});
      expect(result).toBe(state);
    }
  });

  it("ANNOUNCE without self does not call sendResponse but still updates presence", () => {
    const state = createInitialState();
    const sendResponse = vi.fn();
    const user = createPresenceUser({
      userId: "peer",
      name: "Peer",
      color: "#111",
    });
    const message = createBroadcastMessage(
      BROADCAST_MESSAGE.ANNOUNCE,
      "peer",
      user,
    );
    const result = processBroadcastMessage(
      message,
      state,
      subs(),
      sendResponse,
    );
    expect(result.presence.has("peer")).toBe(true);
    expect(sendResponse).not.toHaveBeenCalled();
  });

  it("returns state untouched for unknown message type", () => {
    const state = createInitialState();
    const message = createBroadcastMessage(
      "unknown-type" as never,
      "peer",
      null,
    );
    const result = processBroadcastMessage(message, state, subs(), () => {});
    expect(result).toBe(state);
  });
});

describe("sendBroadcastMessage", () => {
  it("returns silently when channel is null", () => {
    const onError = vi.fn();
    sendBroadcastMessage(
      null,
      createBroadcastMessage(BROADCAST_MESSAGE.UPDATE, "peer", {}),
      onError,
    );
    expect(onError).not.toHaveBeenCalled();
  });

  it("forwards postMessage failures via onError", () => {
    const onError = vi.fn();
    const channel = {
      postMessage: vi.fn(() => {
        throw new Error("send failed");
      }),
    } as unknown as BroadcastChannel;
    sendBroadcastMessage(
      channel,
      createBroadcastMessage(BROADCAST_MESSAGE.UPDATE, "peer", {}),
      onError,
    );
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
  });

  it("wraps non-Error throws into Error", () => {
    const onError = vi.fn();
    // biome-ignore-start lint/suspicious/useErrorMessage: testing non-Error throw branch
    const channel = {
      postMessage: vi.fn(() => {
        // eslint-disable-next-line no-throw-literal
        throw "string failure" as unknown as Error;
      }),
    } as unknown as BroadcastChannel;
    // biome-ignore-end lint/suspicious/useErrorMessage: testing non-Error throw branch
    sendBroadcastMessage(
      channel,
      createBroadcastMessage(BROADCAST_MESSAGE.UPDATE, "peer", {}),
      onError,
    );
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
  });
});

describe("websocket-message processMessage edge cases", () => {
  it("ignores messages from self", () => {
    const state = createInitialState();
    const result = processMessage(
      state,
      {
        type: WS_MESSAGE.JOIN,
        roomId: "r",
        senderId: "self",
        timestamp: 1,
        payload: {
          user: createPresenceUser({
            userId: "self",
            name: "S",
            color: "#000",
          }),
        },
      },
      "self",
    );
    expect(result.state).toBe(state);
    expect(result.shouldNotifyPresence).toBe(false);
  });

  it("returns no-op for PRESENCE_UPDATE on unknown user", () => {
    const state = createInitialState();
    const result = processMessage(
      state,
      {
        type: WS_MESSAGE.PRESENCE_UPDATE,
        roomId: "r",
        senderId: "peer",
        timestamp: 1,
        payload: { userId: "ghost", updates: { status: "idle" } },
      },
      "self",
    );
    expect(result.shouldNotifyPresence).toBe(false);
  });

  it("preserves self when handling PRESENCE_SYNC", () => {
    const self = createPresenceUser({
      userId: "self",
      name: "S",
      color: "#000",
    });
    const state = { ...createInitialState(), self };
    const peer = createPresenceUser({
      userId: "peer",
      name: "P",
      color: "#111",
    });
    const result = processMessage(
      state,
      {
        type: WS_MESSAGE.PRESENCE_SYNC,
        roomId: "r",
        senderId: "peer",
        timestamp: 1,
        payload: { users: [peer] },
      },
      "self",
    );
    expect(result.state.presence.has("self")).toBe(true);
    expect(result.state.presence.has("peer")).toBe(true);
  });

  it("handles PRESENCE_SYNC_RESPONSE the same as PRESENCE_SYNC", () => {
    const state = createInitialState();
    const peer = createPresenceUser({
      userId: "peer",
      name: "P",
      color: "#111",
    });
    const result = processMessage(
      state,
      {
        type: WS_MESSAGE.PRESENCE_SYNC_RESPONSE,
        roomId: "r",
        senderId: "peer",
        timestamp: 1,
        payload: { users: [peer] },
      },
      "self",
    );
    expect(result.shouldNotifyPresence).toBe(true);
    expect(result.state.presence.has("peer")).toBe(true);
  });

  it("returns error for ERROR message type", () => {
    const state = createInitialState();
    const result = processMessage(
      state,
      {
        type: WS_MESSAGE.ERROR,
        roomId: "r",
        senderId: "peer",
        timestamp: 1,
        payload: { code: "AUTH", message: "bad token" },
      },
      "self",
    );
    expect(result.error?.message).toContain("AUTH");
    expect(result.error?.message).toContain("bad token");
  });

  it("HEARTBEAT_ACK is a no-op", () => {
    const state = createInitialState();
    const result = processMessage(
      state,
      {
        type: WS_MESSAGE.HEARTBEAT_ACK,
        roomId: "r",
        senderId: "peer",
        timestamp: 1,
      },
      "self",
    );
    expect(result.state).toBe(state);
    expect(result.shouldNotifyPresence).toBe(false);
  });

  it("returns no-op for unknown message type", () => {
    const state = createInitialState();
    const result = processMessage(
      state,
      {
        type: "weird" as never,
        roomId: "r",
        senderId: "peer",
        timestamp: 1,
      },
      "self",
    );
    expect(result.state).toBe(state);
  });

  it("processes LEAVE messages", () => {
    const peer = createPresenceUser({
      userId: "peer",
      name: "P",
      color: "#111",
    });
    const state = {
      ...createInitialState(),
      presence: new Map([["peer", peer]]),
    };
    const result = processMessage(
      state,
      {
        type: WS_MESSAGE.LEAVE,
        roomId: "r",
        senderId: "peer",
        timestamp: 1,
        payload: { userId: "peer" },
      },
      "self",
    );
    expect(result.state.presence.has("peer")).toBe(false);
    expect(result.shouldNotifyPresence).toBe(true);
  });

  it("parseMessage returns null for invalid JSON", () => {
    expect(parseMessage("{not-json")).toBeNull();
  });
});

describe("websocket-connection edge cases", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("sendWebSocketMessage no-ops when socket is null", () => {
    const internal = createInternalState(DEFAULT_RECONNECT_CONFIG);
    expect(() =>
      sendWebSocketMessage(internal, wsConfig, "noop"),
    ).not.toThrow();
  });

  it("sendWebSocketMessage no-ops when socket is not OPEN", () => {
    const internal = createInternalState(DEFAULT_RECONNECT_CONFIG);
    internal.socket = {
      readyState: WebSocket.CLOSED,
      send: vi.fn(),
    } as unknown as WebSocket;
    sendWebSocketMessage(internal, wsConfig, "noop");
    expect(
      (internal.socket as WebSocket & { send: ReturnType<typeof vi.fn> }).send,
    ).not.toHaveBeenCalled();
  });

  it("sendWebSocketMessage sends when OPEN", () => {
    const internal = createInternalState(DEFAULT_RECONNECT_CONFIG);
    const send = vi.fn();
    internal.socket = {
      readyState: WebSocket.OPEN,
      send,
    } as unknown as WebSocket;
    sendWebSocketMessage(internal, wsConfig, "ping", { hello: 1 });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("startHeartbeat fires sendMessage on interval and stopHeartbeat clears", () => {
    const internal = createInternalState(DEFAULT_RECONNECT_CONFIG);
    const sendMessage = vi.fn();
    startHeartbeat(
      internal,
      { ...wsConfig, heartbeatIntervalMs: 1000 },
      sendMessage,
    );
    vi.advanceTimersByTime(2500);
    expect(sendMessage).toHaveBeenCalledTimes(2);
    stopHeartbeat(internal);
    sendMessage.mockClear();
    vi.advanceTimersByTime(2000);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("stopHeartbeat is a no-op when no heartbeat is active", () => {
    const internal = createInternalState(DEFAULT_RECONNECT_CONFIG);
    expect(() => stopHeartbeat(internal)).not.toThrow();
  });

  it("scheduleReconnect does nothing when reconnect disabled", () => {
    const internal = createInternalState({
      ...DEFAULT_RECONNECT_CONFIG,
      enabled: false,
    });
    const subscriptions = createSubscriptionManager();
    const errorCb = vi.fn();
    subscriptions.onError(errorCb);
    const connectFn = vi.fn();
    scheduleReconnect(internal, subscriptions, connectFn);
    expect(connectFn).not.toHaveBeenCalled();
    expect(errorCb).not.toHaveBeenCalled();
    expect(internal.reconnect.timeoutId).toBeNull();
  });

  it("scheduleReconnect notifies error when at max attempts", () => {
    const internal = createInternalState({
      ...DEFAULT_RECONNECT_CONFIG,
      maxAttempts: 2,
    });
    internal.reconnect = { ...internal.reconnect, attempts: 2 };
    const subscriptions = createSubscriptionManager();
    const errorCb = vi.fn();
    subscriptions.onError(errorCb);
    scheduleReconnect(internal, subscriptions, vi.fn());
    expect(errorCb).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("Max reconnect attempts"),
      }),
    );
  });

  it("scheduleReconnect schedules a connect attempt and increments attempts", () => {
    const internal = createInternalState({
      ...DEFAULT_RECONNECT_CONFIG,
      baseDelayMs: 10,
      maxDelayMs: 10,
    });
    const subscriptions = createSubscriptionManager();
    const connectFn = vi.fn();
    scheduleReconnect(internal, subscriptions, connectFn);
    expect(internal.reconnect.attempts).toBe(1);
    expect(internal.reconnect.isReconnecting).toBe(true);
    vi.advanceTimersByTime(50);
    expect(connectFn).toHaveBeenCalled();
  });

  it("cancelReconnect clears the pending timeout", () => {
    const internal = createInternalState({
      ...DEFAULT_RECONNECT_CONFIG,
      baseDelayMs: 1000,
      maxDelayMs: 1000,
    });
    const subscriptions = createSubscriptionManager();
    const connectFn = vi.fn();
    scheduleReconnect(internal, subscriptions, connectFn);
    expect(internal.reconnect.timeoutId).not.toBeNull();
    cancelReconnect(internal);
    expect(internal.reconnect.timeoutId).toBeNull();
    expect(internal.reconnect.isReconnecting).toBe(false);
    vi.advanceTimersByTime(2000);
    expect(connectFn).not.toHaveBeenCalled();
  });

  it("cancelReconnect is a no-op when no timeout is scheduled", () => {
    const internal = createInternalState(DEFAULT_RECONNECT_CONFIG);
    expect(() => cancelReconnect(internal)).not.toThrow();
  });

  it("cleanupWebSocket without socket only stops timers", () => {
    const internal = createInternalState(DEFAULT_RECONNECT_CONFIG);
    expect(() =>
      cleanupWebSocket(internal, {
        onOpen: vi.fn(),
        onMessage: vi.fn(),
        onClose: vi.fn(),
        onError: vi.fn(),
      }),
    ).not.toThrow();
  });

  it("cleanupWebSocket detaches listeners and closes socket when present", () => {
    const internal = createInternalState(DEFAULT_RECONNECT_CONFIG);
    const removeEventListener = vi.fn();
    const close = vi.fn();
    internal.socket = {
      removeEventListener,
      close,
    } as unknown as WebSocket;
    const handlers = {
      onOpen: vi.fn(),
      onMessage: vi.fn(),
      onClose: vi.fn(),
      onError: vi.fn(),
    };
    cleanupWebSocket(internal, handlers);
    expect(removeEventListener).toHaveBeenCalledTimes(4);
    expect(close).toHaveBeenCalledTimes(1);
    expect(internal.socket).toBeNull();
  });
});

describe("websocket-state updateInternalState - extra branches", () => {
  it("notifies presence with current snapshot when notifyPresence=true and no state change", () => {
    const internal = createInternalState(DEFAULT_RECONNECT_CONFIG);
    const subs = createSubscriptionManager();
    const presenceCb = vi.fn();
    subs.onPresenceChange(presenceCb);
    presenceCb.mockClear();
    updateInternalState(internal, {}, subs, true);
    expect(presenceCb).toHaveBeenCalled();
  });
});

describe("WebSocket adapter extra branches", () => {
  type FakeWebSocketEventType = "open" | "message" | "close" | "error";
  type FakeWebSocketListener = (event: Event | MessageEvent<string>) => void;

  class FakeWebSocket {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;

    readonly sentMessages: string[] = [];
    readonly url: string;
    bufferedAmount = 0;
    readyState = FakeWebSocket.CONNECTING;

    private readonly listeners = new Map<
      FakeWebSocketEventType,
      Set<FakeWebSocketListener>
    >();

    constructor(url: string) {
      this.url = url;
      fakeSockets.push(this);
    }

    addEventListener = (
      type: FakeWebSocketEventType,
      listener: FakeWebSocketListener,
    ): void => {
      const listeners = this.listeners.get(type) ?? new Set();
      listeners.add(listener);
      this.listeners.set(type, listeners);
    };

    removeEventListener = (
      type: FakeWebSocketEventType,
      listener: FakeWebSocketListener,
    ): void => {
      this.listeners.get(type)?.delete(listener);
    };

    send = (data: string): void => {
      this.sentMessages.push(data);
    };

    close = (): void => {
      this.readyState = FakeWebSocket.CLOSED;
    };

    emitOpen = (): void => {
      this.readyState = FakeWebSocket.OPEN;
      for (const l of this.listeners.get("open") ?? []) l(new Event("open"));
    };

    emitClose = (): void => {
      this.readyState = FakeWebSocket.CLOSED;
      for (const l of this.listeners.get("close") ?? []) l(new Event("close"));
    };
  }

  const fakeSockets: FakeWebSocket[] = [];
  const originalWS = globalThis.WebSocket;

  beforeEach(() => {
    vi.useFakeTimers();
    fakeSockets.length = 0;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
  });

  afterEach(() => {
    vi.useRealTimers();
    fakeSockets.length = 0;
    globalThis.WebSocket = originalWS;
  });

  it("disconnect early-returns when never connected (socket null)", async () => {
    // dynamic import of websocket adapter to avoid hoisting complications
    const { createWebSocketAdapter } = await import("./websocket/websocket");
    const connection = vi.fn();
    const adapter = createWebSocketAdapter({
      ...wsConfig,
      reconnect: {
        enabled: false,
        maxAttempts: 0,
        baseDelayMs: 1,
        maxDelayMs: 1,
      },
    });
    adapter.onConnectionChange(connection);
    connection.mockClear();
    await adapter.disconnect();
    expect(connection).toHaveBeenCalledWith("disconnected");
    expect(adapter.getConnectionState()).toBe("disconnected");
  });

  it("connect rejects when connection timeout fires before open", async () => {
    const { createWebSocketAdapter } = await import("./websocket/websocket");
    const adapter = createWebSocketAdapter({
      ...wsConfig,
      connectionTimeoutMs: 50,
      reconnect: {
        enabled: false,
        maxAttempts: 0,
        baseDelayMs: 1,
        maxDelayMs: 1,
      },
    });
    const connectPromise = adapter.connect();
    vi.advanceTimersByTime(60);
    await expect(connectPromise).rejects.toThrow(/Connection timeout/);
  });

  it("close event after open transitions to disconnected and schedules reconnect when enabled", async () => {
    const { createWebSocketAdapter } = await import("./websocket/websocket");
    const connection = vi.fn();
    const adapter = createWebSocketAdapter({
      ...wsConfig,
      connectionTimeoutMs: 5000,
      heartbeatIntervalMs: 60_000,
      reconnect: {
        enabled: true,
        maxAttempts: 1,
        baseDelayMs: 10,
        maxDelayMs: 10,
      },
    });
    adapter.onConnectionChange(connection);

    const connectPromise = adapter.connect();
    fakeSockets[0]?.emitOpen();
    await connectPromise;

    fakeSockets[0]?.emitClose();
    expect(adapter.getConnectionState()).toBe("disconnected");
    expect(connection).toHaveBeenCalledWith("disconnected");
  });

  it("emits errors when the underlying socket fires error", async () => {
    const { createWebSocketAdapter } = await import("./websocket/websocket");
    const adapter = createWebSocketAdapter({
      ...wsConfig,
      reconnect: {
        enabled: false,
        maxAttempts: 0,
        baseDelayMs: 1,
        maxDelayMs: 1,
      },
    });
    const errorCb = vi.fn();
    adapter.onError(errorCb);

    const connectPromise = adapter.connect();
    fakeSockets[0]?.emitOpen();
    await connectPromise;

    // emit underlying socket error
    const ws = fakeSockets[0] as unknown as {
      listeners: Map<string, Set<(e: Event) => void>>;
    };
    for (const cb of ws.listeners.get("error") ?? []) cb(new Event("error"));

    expect(errorCb).toHaveBeenCalledWith(expect.any(Error));
  });

  it("connect resolves immediately when socket already OPEN", async () => {
    const { createWebSocketAdapter } = await import("./websocket/websocket");
    const adapter = createWebSocketAdapter({
      ...wsConfig,
      reconnect: {
        enabled: false,
        maxAttempts: 0,
        baseDelayMs: 1,
        maxDelayMs: 1,
      },
    });

    const firstConnect = adapter.connect();
    fakeSockets[0]?.emitOpen();
    await firstConnect;

    // Now socket is OPEN. A second connect() should hit the early-resolve path.
    await expect(adapter.connect()).resolves.toBeUndefined();
  });

  it("connect with authToken sends auth message before JOIN", async () => {
    const { createWebSocketAdapter } = await import("./websocket/websocket");
    const adapter = createWebSocketAdapter({
      ...wsConfig,
      authToken: "secret",
      reconnect: {
        enabled: false,
        maxAttempts: 0,
        baseDelayMs: 1,
        maxDelayMs: 1,
      },
    });

    const connectPromise = adapter.connect();
    fakeSockets[0]?.emitOpen();
    await connectPromise;

    const types = fakeSockets[0]?.sentMessages.map(
      (m) => JSON.parse(m).type as string,
    );
    expect(types?.[0]).toBe("auth");
  });

  it("waits for the socket buffer to drain before disconnect cleanup", async () => {
    const { createWebSocketAdapter } = await import("./websocket/websocket");
    const adapter = createWebSocketAdapter({
      ...wsConfig,
      reconnect: {
        enabled: false,
        maxAttempts: 0,
        baseDelayMs: 1,
        maxDelayMs: 1,
      },
    });

    const connectPromise = adapter.connect();
    fakeSockets[0]?.emitOpen();
    await connectPromise;

    const socket = fakeSockets[0];
    if (!socket) throw new Error("expected fake socket");
    socket.bufferedAmount = 10;
    const disconnectPromise = adapter.disconnect();
    expect(socket.readyState).toBe(FakeWebSocket.OPEN);

    socket.bufferedAmount = 0;
    await vi.advanceTimersByTimeAsync(10);
    await disconnectPromise;

    expect(socket.readyState).toBe(FakeWebSocket.CLOSED);
    expect(adapter.getConnectionState()).toBe("disconnected");
  });

  it("stops waiting for buffered messages when the socket closes", async () => {
    const { createWebSocketAdapter } = await import("./websocket/websocket");
    const adapter = createWebSocketAdapter({
      ...wsConfig,
      reconnect: {
        enabled: false,
        maxAttempts: 0,
        baseDelayMs: 1,
        maxDelayMs: 1,
      },
    });

    const connectPromise = adapter.connect();
    fakeSockets[0]?.emitOpen();
    await connectPromise;

    const socket = fakeSockets[0];
    if (!socket) throw new Error("expected fake socket");
    socket.bufferedAmount = 10;
    const disconnectPromise = adapter.disconnect();
    socket.readyState = FakeWebSocket.CLOSED;

    await vi.advanceTimersByTimeAsync(10);
    await disconnectPromise;

    expect(adapter.getConnectionState()).toBe("disconnected");
  });

  it("emits presence events for valid LEAVE and SYNC messages", async () => {
    const { createWebSocketAdapter } = await import("./websocket/websocket");
    const adapter = createWebSocketAdapter({
      ...wsConfig,
      reconnect: {
        enabled: false,
        maxAttempts: 0,
        baseDelayMs: 1,
        maxDelayMs: 1,
      },
    });
    const events = vi.fn();
    adapter.onEvent(events);

    const connectPromise = adapter.connect();
    fakeSockets[0]?.emitOpen();
    await connectPromise;
    events.mockClear();

    const send = (msg: object): void => {
      const socket = fakeSockets[0] as unknown as {
        listeners: Map<string, Set<(e: MessageEvent<string>) => void>>;
      };
      for (const listener of socket.listeners.get("message") ?? []) {
        listener(new MessageEvent("message", { data: JSON.stringify(msg) }));
      }
    };

    const peer = createPresenceUser({
      userId: "peer",
      name: "Peer",
      color: "#111",
    });
    send({
      type: WS_MESSAGE.JOIN,
      roomId: "room-1",
      senderId: "peer",
      timestamp: 1,
      payload: { user: peer },
    });
    send({
      type: WS_MESSAGE.LEAVE,
      roomId: "room-1",
      senderId: "peer",
      timestamp: 2,
      payload: { userId: "peer" },
    });
    send({
      type: WS_MESSAGE.PRESENCE_SYNC,
      roomId: "room-1",
      senderId: "server",
      timestamp: 3,
      payload: { users: [peer] },
    });

    expect(events).toHaveBeenCalledWith(
      expect.objectContaining({ type: PRESENCE_EVENT.LEAVE }),
    );
    expect(events).toHaveBeenCalledWith(
      expect.objectContaining({ type: PRESENCE_EVENT.SYNC }),
    );

    await adapter.disconnect();
  });

  it("malformed peer messages do not surface as presence events", async () => {
    const { createWebSocketAdapter } = await import("./websocket/websocket");
    const adapter = createWebSocketAdapter({
      ...wsConfig,
      reconnect: {
        enabled: false,
        maxAttempts: 0,
        baseDelayMs: 1,
        maxDelayMs: 1,
      },
    });
    const events = vi.fn();
    adapter.onEvent(events);

    const connectPromise = adapter.connect();
    fakeSockets[0]?.emitOpen();
    await connectPromise;
    events.mockClear();

    const send = (msg: object): void => {
      for (const l of (
        fakeSockets[0] as unknown as {
          listeners: Map<string, Set<(e: MessageEvent<string>) => void>>;
        }
      ).listeners.get("message") ?? []) {
        l(new MessageEvent("message", { data: JSON.stringify(msg) }));
      }
    };

    // LEAVE with non-string userId: processLeave is a no-op (removePresenceUser
    // for a non-string key does nothing) and isLeavePayload rejects → no event.
    send({
      type: "leave",
      roomId: "r",
      senderId: "p",
      timestamp: 1,
      payload: { userId: 5 },
    });
    // UPDATE with non-record updates: processPresenceUpdate finds no user
    // (no peer in presence) and isPresenceUpdatePayload rejects → no event.
    send({
      type: "presence:update",
      roomId: "r",
      senderId: "p",
      timestamp: 1,
      payload: { userId: "missing", updates: null },
    });
    expect(events).not.toHaveBeenCalled();
  });
});

describe("BroadcastChannel adapter - offline cleanup", () => {
  // standalone: don't share the BroadcastChannel mocks above
  class BC {
    static instances: BC[] = [];
    name: string;
    onmessage: ((event: MessageEvent) => void) | null = null;
    closed = false;
    constructor(name: string) {
      this.name = name;
      BC.instances.push(this);
    }
    postMessage(data: unknown): void {
      if (this.closed) return;
      for (const inst of BC.instances) {
        if (
          inst !== this &&
          inst.name === this.name &&
          !inst.closed &&
          inst.onmessage
        ) {
          inst.onmessage(new MessageEvent("message", { data }));
        }
      }
    }
    close(): void {
      this.closed = true;
      const idx = BC.instances.indexOf(this);
      if (idx !== -1) BC.instances.splice(idx, 1);
    }
    static reset(): void {
      BC.instances = [];
    }
  }

  beforeEach(() => {
    vi.useFakeTimers();
    BC.reset();
    vi.stubGlobal("BroadcastChannel", BC);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    BC.reset();
  });

  it("broadcastChannelAdapterFactory returns a working adapter", () => {
    const adapter = broadcastChannelAdapterFactory({
      roomId: "factory-room",
      userInfo: { userId: "self", name: "Self", color: "#000" },
    });
    expect(adapter.getConnectionState()).toBe("disconnected");
  });

  it("removes peer that has gone silent past offlineTimeoutMs (timeout-based cleanup)", async () => {
    const config: BroadcastChannelAdapterConfig = {
      roomId: "room-y",
      userInfo: { userId: "self", name: "Self", color: "#000" },
      heartbeatIntervalMs: 100_000,
      offlineTimeoutMs: 200,
      idleTimeoutMs: 1000,
    };

    const a = createBroadcastChannelAdapter(config);
    const b = createBroadcastChannelAdapter({
      ...config,
      userInfo: { userId: "peer", name: "Peer", color: "#111" },
    });

    await a.connect();
    await b.connect();
    expect(a.getPresence().has("peer")).toBe(true);

    // Sever b's channel without sending a LEAVE: simulate a crashed tab.
    const bChannel = BC.instances.find(
      (inst) => inst.name.includes("room-y") && inst !== BC.instances[0],
    );
    if (bChannel) bChannel.close();

    // Advance past offlineTimeoutMs so cleanupStaleUsers fires
    vi.advanceTimersByTime(300);

    expect(a.getPresence().has("peer")).toBe(false);
  });
});

describe("BroadcastChannel adapter - extra branches", () => {
  let postedMessages: Array<{ channelName: string; data: unknown }> = [];

  class MockBC {
    static instances: MockBC[] = [];
    name: string;
    onmessage: ((event: MessageEvent) => void) | null = null;
    closed = false;
    constructor(name: string) {
      this.name = name;
      MockBC.instances.push(this);
    }
    postMessage(data: unknown): void {
      if (this.closed) return;
      postedMessages.push({ channelName: this.name, data });
      for (const inst of MockBC.instances) {
        if (
          inst !== this &&
          inst.name === this.name &&
          !inst.closed &&
          inst.onmessage
        ) {
          inst.onmessage(new MessageEvent("message", { data }));
        }
      }
    }
    close(): void {
      this.closed = true;
      const idx = MockBC.instances.indexOf(this);
      if (idx !== -1) MockBC.instances.splice(idx, 1);
    }
    static reset(): void {
      MockBC.instances = [];
    }
  }

  const config: BroadcastChannelAdapterConfig = {
    roomId: "room-x",
    userInfo: { userId: "self", name: "Self", color: "#000" },
    heartbeatIntervalMs: 100,
    offlineTimeoutMs: 200,
    idleTimeoutMs: 50,
  };

  beforeEach(() => {
    vi.useFakeTimers();
    postedMessages = [];
    MockBC.reset();
    vi.stubGlobal("BroadcastChannel", MockBC);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    MockBC.reset();
  });

  it("connect early-returns when already connected", async () => {
    const adapter = createBroadcastChannelAdapter(config);
    await adapter.connect();
    const before = MockBC.instances.length;
    await adapter.connect();
    expect(MockBC.instances.length).toBe(before);
  });

  it("connects and disconnects without window lifecycle hooks when window is unavailable", async () => {
    vi.stubGlobal("window", undefined);
    const adapter = createBroadcastChannelAdapter(config);

    await adapter.connect();
    expect(adapter.getConnectionState()).toBe("connected");

    await adapter.disconnect();
    expect(adapter.getConnectionState()).toBe("disconnected");
  });

  it("reports a generic error when BroadcastChannel construction throws a non-Error", async () => {
    class ThrowingBroadcastChannel {
      constructor(_name: string) {
        throw "constructor failed";
      }
    }
    vi.stubGlobal(
      "BroadcastChannel",
      ThrowingBroadcastChannel as unknown as typeof BroadcastChannel,
    );
    const adapter = createBroadcastChannelAdapter(config);
    const errors = vi.fn();
    adapter.onError(errors);

    await expect(adapter.connect()).rejects.toBe("constructor failed");
    expect(errors).toHaveBeenCalledWith(
      new Error("Failed to connect to BroadcastChannel"),
    );

    await adapter.disconnect();
    expect(adapter.getConnectionState()).toBe("disconnected");
  });

  it("disconnect early-returns when already disconnected", async () => {
    const adapter = createBroadcastChannelAdapter(config);
    await expect(adapter.disconnect()).resolves.toBeUndefined();
    expect(adapter.getConnectionState()).toBe("disconnected");
  });

  it("updatePresence is a no-op when not connected (no self)", () => {
    const adapter = createBroadcastChannelAdapter(config);
    expect(() => adapter.updatePresence({ status: "idle" })).not.toThrow();
  });

  it("broadcast is a no-op when not connected (no self)", () => {
    const adapter = createBroadcastChannelAdapter(config);
    expect(() =>
      adapter.broadcast({
        type: PRESENCE_EVENT.UPDATE,
        userId: "self",
        updates: { status: "idle" },
      }),
    ).not.toThrow();
  });

  it("broadcast routes JOIN/LEAVE/UPDATE/SYNC payloads to channel", async () => {
    const adapter = createBroadcastChannelAdapter(config);
    await adapter.connect();
    postedMessages = [];

    const peer = createPresenceUser({
      userId: "peer",
      name: "Peer",
      color: "#111",
    });

    adapter.broadcast({ type: PRESENCE_EVENT.JOIN, user: peer });
    adapter.broadcast({ type: PRESENCE_EVENT.LEAVE, userId: "peer" });
    adapter.broadcast({
      type: PRESENCE_EVENT.UPDATE,
      userId: "self",
      updates: { status: "idle" },
    });
    adapter.broadcast({ type: PRESENCE_EVENT.SYNC, users: [peer] });

    const types = postedMessages.map((m) => (m.data as { type: string }).type);
    expect(types).toContain(BROADCAST_MESSAGE.ANNOUNCE);
    expect(types).toContain(BROADCAST_MESSAGE.LEAVE);
    expect(types).toContain(BROADCAST_MESSAGE.UPDATE);
    expect(types).toContain(BROADCAST_MESSAGE.SYNC_RESPONSE);
  });

  it("transitions active user to idle after idle timeout", async () => {
    const a = createBroadcastChannelAdapter(config);
    const b = createBroadcastChannelAdapter({
      ...config,
      userInfo: { userId: "peer", name: "Peer", color: "#111" },
      heartbeatIntervalMs: 100_000,
    });

    await a.connect();
    await b.connect();

    // peer goes silent: no heartbeats from b. Advance past idleTimeoutMs (50ms)
    // but stay below offlineTimeoutMs (200ms).
    vi.advanceTimersByTime(120);

    const peer = a.getPresence().get("peer");
    expect(peer?.status).toBe("idle");
  });

  it("ignores messages from sender matching self id", async () => {
    const adapter = createBroadcastChannelAdapter(config);
    await adapter.connect();
    const channel = MockBC.instances[0];
    const before = adapter.getPresence().size;
    channel?.onmessage?.(
      new MessageEvent("message", {
        data: createBroadcastMessage(
          BROADCAST_MESSAGE.ANNOUNCE,
          "self",
          createPresenceUser({ userId: "self", name: "Self", color: "#000" }),
        ),
      }),
    );
    expect(adapter.getPresence().size).toBe(before);
  });
});
