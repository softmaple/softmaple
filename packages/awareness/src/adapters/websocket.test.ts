/**
 * Tests for WebSocket presence adapter
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPresenceUser } from "../types/presence";
import type { AdapterState } from "./adapter-state";
import { createInitialState, setPresenceUser } from "./adapter-state";
import { createWebSocketAdapter } from "./websocket";
import {
  createMessage,
  parseMessage,
  processMessage,
  serializeMessage,
} from "./websocket-message";
import {
  calculateReconnectDelay,
  createReconnectState,
  WS_MESSAGE,
} from "./websocket-types";

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
        userId: "user-2",
        name: "User 2",
        color: "#00FF00",
      });

      const message = createMessage(WS_MESSAGE.JOIN, "room-1", "other-sender", {
        user: newUser,
      });

      const result = processMessage(state, message, selfId);
      expect(result.shouldNotifyPresence).toBe(true);
      expect(result.state.presence.has("user-2")).toBe(true);
    });

    it("should process LEAVE message and remove user", () => {
      const user = createPresenceUser({
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
        { userId: "user-2" },
      );

      const result = processMessage(state, message, selfId);
      expect(result.shouldNotifyPresence).toBe(true);
      expect(result.state.presence.has("user-2")).toBe(false);
    });

    it("should process PRESENCE_UPDATE message", () => {
      const user = createPresenceUser({
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
        { userId: "user-2", updates: { name: "Updated Name" } },
      );

      const result = processMessage(state, message, selfId);
      expect(result.shouldNotifyPresence).toBe(true);
      expect(result.state.presence.get("user-2")?.name).toBe("Updated Name");
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
    fakeSockets[0]?.emitOpen();
    await connectPromise;

    const echoedTyping = serializeMessage(
      createMessage(WS_MESSAGE.PRESENCE_UPDATE, "room-1", "self-user", {
        userId: "self-user",
        updates: { meta: { isTyping: true } },
      }),
    );

    fakeSockets[0]?.emitMessage(echoedTyping);

    expect(events).not.toHaveBeenCalled();

    await adapter.disconnect();
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
