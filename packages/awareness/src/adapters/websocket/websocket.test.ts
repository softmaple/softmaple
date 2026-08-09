/**
 * Tests for WebSocket presence adapter
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PRESENCE_EVENT } from "../../types/events";
import { createPresenceUser } from "../../types/presence";
import type { AdapterState } from "../adapter-state";
import { createInitialState, setPresenceUser } from "../adapter-state";
import {
  createMessage,
  parseMessage,
  processMessage,
  serializeMessage,
} from "./message";
import {
  calculateReconnectDelay,
  createReconnectState,
  WS_MESSAGE,
} from "./types";
import { createWebSocketAdapter, webSocketAdapterFactory } from "./websocket";

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
    this.emit("open", new Event("open"));
  };

  emitClose = (): void => {
    this.readyState = FakeWebSocket.CLOSED;
    this.emit("close", new Event("close"));
  };

  emitMessage = (data: string): void => {
    this.emit("message", new MessageEvent("message", { data }));
  };

  private emit = (
    type: FakeWebSocketEventType,
    event: Event | MessageEvent<string>,
  ): void => {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  };
}

const fakeSockets: FakeWebSocket[] = [];
const originalWebSocket = globalThis.WebSocket;

const completeReadyHandshake = (
  socket: FakeWebSocket,
  roomId = "room-1",
  options: { authOk?: boolean } = {},
): void => {
  socket.emitOpen();
  if (options.authOk) {
    socket.emitMessage(
      serializeMessage(createMessage(WS_MESSAGE.AUTH_OK, roomId, "server", {})),
    );
  }
  socket.emitMessage(
    serializeMessage(
      createMessage(WS_MESSAGE.PRESENCE_SYNC_RESPONSE, roomId, "server", {
        users: [],
      }),
    ),
  );
};

describe("WebSocket Message Utilities", () => {
  describe("createMessage", () => {
    it("should create a message with correct fields", () => {
      const message = createMessage(WS_MESSAGE.JOIN, "room-1", "user-1", {
        user: {},
      });

      expect(message.type).toBe(WS_MESSAGE.JOIN);
      expect(message.roomId).toBe("room-1");
      expect(message.senderId).toBe("user-1");
      expect(message.payload).toEqual({ user: {} });
      expect(typeof message.timestamp).toBe("number");
    });
  });

  describe("serializeMessage / parseMessage", () => {
    it("should round-trip messages correctly", () => {
      const original = createMessage(
        WS_MESSAGE.PRESENCE_UPDATE,
        "room-1",
        "user-1",
        { updates: { name: "New Name" } },
      );

      const serialized = serializeMessage(original);
      const parsed = parseMessage(serialized);

      expect(parsed).toEqual(original);
    });

    it("should return null for invalid JSON", () => {
      expect(parseMessage("not valid json")).toBeNull();
    });
  });

  describe("processMessage", () => {
    const selfId = "self-user";
    let state: AdapterState;

    beforeEach(() => {
      state = createInitialState();
    });

    it("should ignore messages from self", () => {
      const message = createMessage(WS_MESSAGE.JOIN, "room-1", selfId, {
        user: createPresenceUser({
          userId: selfId,
          name: "Self",
          color: "#000",
        }),
      });

      const result = processMessage(state, message, selfId);
      expect(result.shouldNotifyPresence).toBe(false);
      expect(result.state).toBe(state);
    });

    it("should process JOIN message and add user", () => {
      const newUser = createPresenceUser({
        connectionId: "conn-2",
        userId: "user-2",
        name: "User 2",
        color: "#00FF00",
      });

      const message = createMessage(WS_MESSAGE.JOIN, "room-1", "other-sender", {
        user: newUser,
      });

      const result = processMessage(state, message, selfId);
      expect(result.shouldNotifyPresence).toBe(true);
      expect(result.state.presence.has("conn-2")).toBe(true);
    });

    it("should process LEAVE message and remove user", () => {
      const user = createPresenceUser({
        connectionId: "conn-2",
        userId: "user-2",
        name: "User 2",
        color: "#00FF00",
      });
      state = {
        ...state,
        presence: setPresenceUser(state.presence, user),
      };

      const message = createMessage(
        WS_MESSAGE.LEAVE,
        "room-1",
        "other-sender",
        { connectionId: "conn-2", userId: "user-2" },
      );

      const result = processMessage(state, message, selfId);
      expect(result.shouldNotifyPresence).toBe(true);
      expect(result.state.presence.has("conn-2")).toBe(false);
    });

    it("should process PRESENCE_UPDATE message", () => {
      const user = createPresenceUser({
        connectionId: "conn-2",
        userId: "user-2",
        name: "User 2",
        color: "#00FF00",
      });
      state = {
        ...state,
        presence: setPresenceUser(state.presence, user),
      };

      const message = createMessage(
        WS_MESSAGE.PRESENCE_UPDATE,
        "room-1",
        "other-sender",
        {
          connectionId: "conn-2",
          userId: "user-2",
          clock: 1,
          updates: { name: "Updated Name" },
        },
      );

      const result = processMessage(state, message, selfId);
      expect(result.shouldNotifyPresence).toBe(true);
      expect(result.state.presence.get("conn-2")?.name).toBe("Updated Name");
    });

    it("should process PRESENCE_SYNC message", () => {
      const users = [
        createPresenceUser({ userId: "u1", name: "U1", color: "#111" }),
        createPresenceUser({ userId: "u2", name: "U2", color: "#222" }),
      ];

      const message = createMessage(
        WS_MESSAGE.PRESENCE_SYNC,
        "room-1",
        "server",
        { users },
      );

      const result = processMessage(state, message, selfId);
      expect(result.shouldNotifyPresence).toBe(true);
      expect(result.state.presence.size).toBe(2);
      expect(result.syncCompleted).toBe(false);
    });

    it("marks syncCompleted only for PRESENCE_SYNC_RESPONSE", () => {
      const users = [
        createPresenceUser({ userId: "u1", name: "U1", color: "#111" }),
      ];
      const result = processMessage(
        state,
        createMessage(WS_MESSAGE.PRESENCE_SYNC_RESPONSE, "room-1", "server", {
          users,
        }),
        selfId,
      );
      expect(result.syncCompleted).toBe(true);
    });

    it("ignores peer AUTH_OK even when authenticating", () => {
      const result = processMessage(
        { ...state, connectionState: "authenticating" },
        createMessage(WS_MESSAGE.AUTH_OK, "room-1", "peer", {}),
        selfId,
      );
      expect(result.authOk).toBeUndefined();
    });

    it("accepts server AUTH_OK when authenticating", () => {
      const result = processMessage(
        { ...state, connectionState: "authenticating" },
        createMessage(WS_MESSAGE.AUTH_OK, "room-1", "server", {}),
        selfId,
      );
      expect(result.authOk).toBe(true);
    });

    it("ignores server AUTH_OK when not authenticating", () => {
      const result = processMessage(
        { ...state, connectionState: "connected" },
        createMessage(WS_MESSAGE.AUTH_OK, "room-1", "server", {}),
        selfId,
      );
      expect(result.authOk).toBeUndefined();
    });

    it("should process ERROR message", () => {
      const message = createMessage(WS_MESSAGE.ERROR, "room-1", "server", {
        code: "AUTH_FAILED",
        message: "Invalid token",
      });

      const result = processMessage(state, message, selfId);
      expect(result.shouldNotifyPresence).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error?.message).toContain("AUTH_FAILED");
    });
  });
});

describe("WebSocket adapter events", () => {
  afterEach(() => {
    fakeSockets.length = 0;
    globalThis.WebSocket = originalWebSocket;
  });

  it("does not notify events for echoed self messages", async () => {
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

    const adapter = createWebSocketAdapter({
      roomId: "room-1",
      url: "ws://localhost:1234",
      connectionId: "self-user",
      userInfo: {
        userId: "self-user",
        name: "Self User",
        color: "#2563eb",
      },
      connectionTimeoutMs: 1000,
      heartbeatIntervalMs: 60_000,
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
    completeReadyHandshake(fakeSockets[0]!);
    await connectPromise;
    events.mockClear();

    const echoedTyping = serializeMessage(
      createMessage(WS_MESSAGE.PRESENCE_UPDATE, "room-1", "self-user", {
        connectionId: "self-user",
        userId: "self-user",
        clock: 1,
        updates: { meta: { isTyping: true } },
      }),
    );

    fakeSockets[0]?.emitMessage(echoedTyping);

    expect(events).not.toHaveBeenCalled();

    await adapter.disconnect();
  });
});

describe("WebSocket adapter public API", () => {
  const baseConfig = {
    roomId: "room-1",
    url: "ws://localhost:1234",
    connectionId: "self-user",
    userInfo: { userId: "self-user", name: "Self User", color: "#2563eb" },
    connectionTimeoutMs: 1000,
    heartbeatIntervalMs: 60_000,
    reconnect: {
      enabled: false,
      maxAttempts: 0,
      baseDelayMs: 1,
      maxDelayMs: 1,
    },
  };

  beforeEach(() => {
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
  });

  afterEach(() => {
    fakeSockets.length = 0;
    globalThis.WebSocket = originalWebSocket;
  });

  it("forwards malformed inbound payloads to adapter.onError", async () => {
    const adapter = createWebSocketAdapter(baseConfig);
    const errors: Error[] = [];
    adapter.onError((error) => {
      errors.push(error);
    });

    const connectPromise = adapter.connect();
    completeReadyHandshake(fakeSockets[0]!);
    await connectPromise;

    // PRESENCE_UPDATE with a malformed cursor shape — `blockId` present but
    // `offset` missing. The runtime guard should reject and the websocket
    // handler should pipe `result.error` into `subscriptions.notifyError`.
    const badFrame = serializeMessage(
      createMessage(WS_MESSAGE.PRESENCE_UPDATE, "room-1", "peer", {
        userId: "peer",
        updates: { cursor: { blockId: "b" } },
      }),
    );
    fakeSockets[0]?.emitMessage(badFrame);

    expect(errors.some((e) => e.message.includes("PRESENCE_UPDATE"))).toBe(
      true,
    );

    await adapter.disconnect();
  });

  it("connect → handleOpen sends JOIN + PRESENCE_SYNC and notifies callbacks", async () => {
    const adapter = createWebSocketAdapter(baseConfig);
    const presence = vi.fn();
    const connection = vi.fn();

    adapter.onPresenceChange(presence);
    adapter.onConnectionChange(connection);

    const connectPromise = adapter.connect();
    completeReadyHandshake(fakeSockets[0]!);
    await connectPromise;

    const sent = fakeSockets[0]?.sentMessages.map(
      (m) => JSON.parse(m).type as string,
    );
    expect(sent).toContain(WS_MESSAGE.JOIN);
    expect(sent).toContain(WS_MESSAGE.PRESENCE_SYNC);

    expect(connection).toHaveBeenCalledWith("connecting");
    expect(connection).toHaveBeenCalledWith("connected");
    expect(adapter.getConnectionState()).toBe("connected");
    expect(adapter.getSelf()?.userId).toBe("self-user");
    expect(adapter.getPresence().has("self-user")).toBe(true);

    await adapter.disconnect();
  });

  it("updatePresence sends PRESENCE_UPDATE and notifies presence subscribers", async () => {
    const adapter = createWebSocketAdapter(baseConfig);
    const presence = vi.fn();
    adapter.onPresenceChange(presence);

    const connectPromise = adapter.connect();
    completeReadyHandshake(fakeSockets[0]!);
    await connectPromise;
    presence.mockClear();
    if (fakeSockets[0]) {
      fakeSockets[0].sentMessages.length = 0;
    }

    adapter.updatePresence({ cursor: { blockId: "b1", offset: 5 } });

    expect(presence).toHaveBeenCalledTimes(1);
    const lastSent = JSON.parse(fakeSockets[0]?.sentMessages[0] ?? "{}");
    expect(lastSent.type).toBe(WS_MESSAGE.PRESENCE_UPDATE);
    expect(lastSent.payload.updates.cursor).toEqual({
      blockId: "b1",
      offset: 5,
    });
    expect(adapter.getSelf()?.cursor).toEqual({ blockId: "b1", offset: 5 });

    await adapter.disconnect();
  });

  it("updatePresence is a no-op before connect", () => {
    const adapter = createWebSocketAdapter(baseConfig);
    expect(() =>
      adapter.updatePresence({ cursor: { blockId: "b", offset: 0 } }),
    ).not.toThrow();
    expect(adapter.getSelf()).toBeNull();
  });

  it("broadcast emits an event and sends a wire message", async () => {
    const adapter = createWebSocketAdapter(baseConfig);
    const events = vi.fn();
    adapter.onEvent(events);

    const connectPromise = adapter.connect();
    completeReadyHandshake(fakeSockets[0]!);
    await connectPromise;
    if (fakeSockets[0]) {
      fakeSockets[0].sentMessages.length = 0;
    }

    adapter.broadcast({
      type: PRESENCE_EVENT.UPDATE,
      connectionId: "self-user",
      userId: "self-user",
      clock: 1,
      updates: { meta: { isTyping: true } },
    });

    expect(events).toHaveBeenCalledWith(
      expect.objectContaining({ type: PRESENCE_EVENT.UPDATE }),
    );
    const sent = JSON.parse(fakeSockets[0]?.sentMessages[0] ?? "{}");
    expect(sent.type).toBe(PRESENCE_EVENT.UPDATE);

    await adapter.disconnect();
  });

  it("broadcast is a no-op before connect", () => {
    const adapter = createWebSocketAdapter(baseConfig);
    expect(() =>
      adapter.broadcast({
        type: PRESENCE_EVENT.UPDATE,
        connectionId: "self-user",
        userId: "self-user",
        clock: 1,
        updates: {},
      }),
    ).not.toThrow();
  });

  it("incoming JOIN from peer adds them to presence", async () => {
    const adapter = createWebSocketAdapter(baseConfig);
    const events = vi.fn();
    const presence = vi.fn();
    adapter.onEvent(events);
    adapter.onPresenceChange(presence);

    const connectPromise = adapter.connect();
    completeReadyHandshake(fakeSockets[0]!);
    await connectPromise;
    events.mockClear();
    presence.mockClear();

    const joiningUser = createPresenceUser({
      connectionId: "peer",
      userId: "peer",
      name: "Peer",
      color: "#fff",
    });
    fakeSockets[0]?.emitMessage(
      serializeMessage(
        createMessage(WS_MESSAGE.JOIN, "room-1", "peer", {
          user: joiningUser,
        }),
      ),
    );

    expect(events).toHaveBeenCalledWith(
      expect.objectContaining({ type: PRESENCE_EVENT.JOIN }),
    );
    expect(presence).toHaveBeenCalled();
    expect(adapter.getPresence().has("peer")).toBe(true);

    await adapter.disconnect();
  });

  it("disconnect closes the socket and resets connection state", async () => {
    const adapter = createWebSocketAdapter(baseConfig);
    const connection = vi.fn();
    adapter.onConnectionChange(connection);

    const connectPromise = adapter.connect();
    completeReadyHandshake(fakeSockets[0]!);
    await connectPromise;

    await adapter.disconnect();

    expect(adapter.getConnectionState()).toBe("disconnected");
    expect(connection).toHaveBeenCalledWith("disconnected");
  });

  it("onError subscribers receive errors emitted by the adapter", async () => {
    const adapter = createWebSocketAdapter(baseConfig);
    const errors = vi.fn();
    adapter.onError(errors);

    const connectPromise = adapter.connect();
    completeReadyHandshake(fakeSockets[0]!);
    await connectPromise;

    fakeSockets[0]?.emitMessage(
      serializeMessage(
        createMessage(WS_MESSAGE.ERROR, "room-1", "server", {
          code: "AUTH_REJECTED",
          message: "bad token",
        }),
      ),
    );

    expect(errors).toHaveBeenCalledWith(expect.any(Error));
    await adapter.disconnect();
  });

  it("webSocketAdapterFactory returns a working adapter", () => {
    const adapter = webSocketAdapterFactory(baseConfig);
    expect(typeof adapter.connect).toBe("function");
    expect(typeof adapter.disconnect).toBe("function");
    expect(adapter.getConnectionState()).toBe("disconnected");
  });

  it("publishes reconnecting after an unexpected close and recovers", async () => {
    vi.useFakeTimers();
    const adapter = createWebSocketAdapter({
      ...baseConfig,
      reconnect: {
        enabled: true,
        maxAttempts: 3,
        baseDelayMs: 100,
        maxDelayMs: 100,
      },
    });
    const connection = vi.fn();
    adapter.onConnectionChange(connection);

    const connectPromise = adapter.connect();
    completeReadyHandshake(fakeSockets[0]!);
    await connectPromise;
    expect(adapter.getConnectionState()).toBe("connected");

    fakeSockets[0]?.emitClose();
    expect(adapter.getConnectionState()).toBe("reconnecting");
    expect(connection).toHaveBeenCalledWith("reconnecting");

    await vi.advanceTimersByTimeAsync(150);
    expect(fakeSockets.length).toBeGreaterThanOrEqual(2);
    completeReadyHandshake(fakeSockets[1]!);
    expect(adapter.getConnectionState()).toBe("connected");

    await adapter.disconnect();
    vi.useRealTimers();
  });
});

describe("Reconnect Utilities", () => {
  describe("calculateReconnectDelay", () => {
    it("should use exponential backoff", () => {
      const config = {
        enabled: true,
        maxAttempts: 5,
        baseDelayMs: 1000,
        maxDelayMs: 30000,
      };

      // Mock Math.random for predictable jitter
      vi.spyOn(Math, "random").mockReturnValue(0.5);

      const state0 = createReconnectState(config);
      const delay0 = calculateReconnectDelay(state0);
      expect(delay0).toBe(1000); // base * 2^0 = 1000

      const state1 = { ...state0, attempts: 1 };
      const delay1 = calculateReconnectDelay(state1);
      expect(delay1).toBe(2000); // base * 2^1 = 2000

      const state2 = { ...state0, attempts: 2 };
      const delay2 = calculateReconnectDelay(state2);
      expect(delay2).toBe(4000); // base * 2^2 = 4000

      vi.restoreAllMocks();
    });

    it("should cap delay at maxDelayMs", () => {
      const config = {
        enabled: true,
        maxAttempts: 10,
        baseDelayMs: 1000,
        maxDelayMs: 5000,
      };

      vi.spyOn(Math, "random").mockReturnValue(0.5);

      const state = { ...createReconnectState(config), attempts: 10 };
      const delay = calculateReconnectDelay(state);
      expect(delay).toBe(5000); // capped at max

      vi.restoreAllMocks();
    });
  });
});
