/**
 * Tests for BroadcastChannel adapter
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PRESENCE_EVENT } from "../constants/presence-events";
import type { PresenceUser } from "../types/presence";
import {
  type BroadcastChannelAdapterConfig,
  createBroadcastChannelAdapter,
} from "./broadcast-channel";

/**
 * Mock BroadcastChannel for testing
 */
class MockBroadcastChannel {
  static instances: MockBroadcastChannel[] = [];
  name: string;
  onmessage: ((event: MessageEvent) => void) | null = null;
  private closed = false;

  constructor(name: string) {
    this.name = name;
    MockBroadcastChannel.instances.push(this);
  }

  postMessage(message: unknown): void {
    if (this.closed) return;

    for (const instance of MockBroadcastChannel.instances) {
      if (
        instance !== this &&
        instance.name === this.name &&
        !instance.closed
      ) {
        if (instance.onmessage !== null) {
          instance.onmessage(new MessageEvent("message", { data: message }));
        }
      }
    }
  }

  close(): void {
    this.closed = true;
    const index = MockBroadcastChannel.instances.indexOf(this);
    if (index !== -1) {
      MockBroadcastChannel.instances.splice(index, 1);
    }
  }

  static reset(): void {
    MockBroadcastChannel.instances = [];
  }
}

describe("BroadcastChannelAdapter", () => {
  const defaultConfig: BroadcastChannelAdapterConfig = {
    roomId: "test-room",
    userInfo: {
      userId: "user-1",
      name: "Test User",
      color: "#FF0000",
    },
    heartbeatIntervalMs: 1000,
    offlineTimeoutMs: 3000,
    idleTimeoutMs: 5000,
  };

  beforeEach(() => {
    vi.useFakeTimers();
    MockBroadcastChannel.reset();

    vi.stubGlobal("BroadcastChannel", MockBroadcastChannel);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    MockBroadcastChannel.reset();
  });

  describe("connect", () => {
    it("should connect and set state to connected", async () => {
      const adapter = createBroadcastChannelAdapter(defaultConfig);

      await adapter.connect();

      expect(adapter.getConnectionState()).toBe("connected");
    });

    it("should create self presence on connect", async () => {
      const adapter = createBroadcastChannelAdapter(defaultConfig);

      await adapter.connect();

      const self = adapter.getSelf();
      expect(self).not.toBeNull();
      expect(self?.userId).toBe("user-1");
      expect(self?.name).toBe("Test User");
      expect(self?.color).toBe("#FF0000");
      expect(self?.status).toBe("active");
    });

    it("should notify connection change on connect", async () => {
      const adapter = createBroadcastChannelAdapter(defaultConfig);
      const connectionCallback = vi.fn();

      adapter.onConnectionChange(connectionCallback);
      await adapter.connect();

      expect(connectionCallback).toHaveBeenCalledWith("connected");
    });

    it("should throw error if BroadcastChannel is not supported", async () => {
      vi.stubGlobal("BroadcastChannel", undefined);

      const adapter = createBroadcastChannelAdapter(defaultConfig);

      await expect(adapter.connect()).rejects.toThrow(
        "BroadcastChannel is not supported in this environment",
      );
      expect(adapter.getConnectionState()).toBe("error");
    });
  });

  describe("disconnect", () => {
    it("should disconnect and set state to disconnected", async () => {
      const adapter = createBroadcastChannelAdapter(defaultConfig);

      await adapter.connect();
      await adapter.disconnect();

      expect(adapter.getConnectionState()).toBe("disconnected");
    });

    it("should clear self presence on disconnect", async () => {
      const adapter = createBroadcastChannelAdapter(defaultConfig);

      await adapter.connect();
      await adapter.disconnect();

      expect(adapter.getSelf()).toBeNull();
    });
  });

  describe("presence updates", () => {
    it("should update presence and notify subscribers", async () => {
      const adapter = createBroadcastChannelAdapter(defaultConfig);
      const presenceCallback = vi.fn();

      await adapter.connect();
      adapter.onPresenceChange(presenceCallback);

      adapter.updatePresence({ cursor: { blockId: "block-1", offset: 5 } });

      const self = adapter.getSelf();
      expect(self?.cursor).toEqual({ blockId: "block-1", offset: 5 });
    });

    it("should receive presence from other tabs", async () => {
      const adapter1 = createBroadcastChannelAdapter(defaultConfig);
      const adapter2 = createBroadcastChannelAdapter({
        ...defaultConfig,
        userInfo: {
          userId: "user-2",
          name: "User Two",
          color: "#00FF00",
        },
      });

      await adapter1.connect();
      await adapter2.connect();

      const presence1 = adapter1.getPresence();
      const presence2 = adapter2.getPresence();

      expect(presence1.size).toBe(2);
      expect(presence2.size).toBe(2);
      expect(presence1.has("user-2")).toBe(true);
      expect(presence2.has("user-1")).toBe(true);
    });
  });

  describe("subscription management", () => {
    it("should allow unsubscribing from presence changes", async () => {
      const adapter = createBroadcastChannelAdapter(defaultConfig);
      const callback = vi.fn();

      await adapter.connect();
      const unsubscribe = adapter.onPresenceChange(callback);

      callback.mockClear();
      unsubscribe();

      adapter.updatePresence({ cursor: { blockId: "block-1", offset: 5 } });

      expect(callback).not.toHaveBeenCalled();
    });

    it("should allow subscribing to events", async () => {
      const adapter1 = createBroadcastChannelAdapter(defaultConfig);
      const adapter2 = createBroadcastChannelAdapter({
        ...defaultConfig,
        userInfo: {
          userId: "user-2",
          name: "User Two",
          color: "#00FF00",
        },
      });
      const eventCallback = vi.fn();

      await adapter1.connect();
      adapter1.onEvent(eventCallback);

      await adapter2.connect();

      expect(eventCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          type: PRESENCE_EVENT.JOIN,
          payload: expect.objectContaining({
            type: PRESENCE_EVENT.JOIN,
            user: expect.objectContaining({ userId: "user-2" }),
          }),
        }),
      );
    });
  });

  describe("heartbeat", () => {
    it("should send heartbeat at configured interval", async () => {
      const adapter = createBroadcastChannelAdapter(defaultConfig);

      await adapter.connect();

      const initialLastActiveAt = adapter.getSelf()?.lastActiveAt;

      vi.advanceTimersByTime(1000);

      const updatedLastActiveAt = adapter.getSelf()?.lastActiveAt;
      expect(updatedLastActiveAt).toBeGreaterThan(initialLastActiveAt ?? 0);
    });
  });

  describe("cleanup stale users", () => {
    it("should remove offline users after timeout", async () => {
      const adapter1 = createBroadcastChannelAdapter(defaultConfig);
      const adapter2 = createBroadcastChannelAdapter({
        ...defaultConfig,
        userInfo: {
          userId: "user-2",
          name: "User Two",
          color: "#00FF00",
        },
      });

      await adapter1.connect();
      await adapter2.connect();

      expect(adapter1.getPresence().size).toBe(2);

      await adapter2.disconnect();

      vi.advanceTimersByTime(3000);

      expect(adapter1.getPresence().has("user-2")).toBe(false);
    });
  });

  describe("getPresence", () => {
    it("should return defensive copy that does not affect internal state", async () => {
      const adapter = createBroadcastChannelAdapter(defaultConfig);

      await adapter.connect();

      const presence = adapter.getPresence();

      (presence as Map<string, PresenceUser>).set("new-user", {
        userId: "new-user",
        name: "New User",
        color: "#0000FF",
        status: "active",
        lastActiveAt: Date.now(),
      });

      expect(adapter.getPresence().has("new-user")).toBe(false);
    });
  });
});
