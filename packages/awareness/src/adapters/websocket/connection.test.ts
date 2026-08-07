import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_RECONNECT_CONFIG } from "../types";
import {
  clearHeartbeatAckTimeout,
  handleHeartbeatAck,
  startHeartbeat,
  stopHeartbeat,
} from "./connection";
import { createInternalState } from "./state";
import type { WebSocketAdapterConfig } from "./types";

const baseConfig = (): WebSocketAdapterConfig => ({
  url: "ws://localhost",
  roomId: "room",
  userInfo: { userId: "u", name: "U", color: "#000" },
  connectionId: "c1",
  heartbeatIntervalMs: 1_000,
  heartbeatAckTimeoutMs: 50,
  heartbeatMissedAckLimit: 2,
});

const reconnectConfig = {
  ...DEFAULT_RECONNECT_CONFIG,
  maxAttempts: 3,
};

describe("websocket heartbeat ACK", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("counts missed ACKs and invokes onMissedAcks at the limit", () => {
    const internal = createInternalState(reconnectConfig);
    const sendMessage = vi.fn();
    const onMissedAcks = vi.fn();

    startHeartbeat(internal, baseConfig(), sendMessage, onMissedAcks);
    expect(sendMessage).toHaveBeenCalledWith(
      "heartbeat",
      expect.objectContaining({ pingId: expect.any(String) }),
    );
    expect(internal.pendingPingId).toBeTruthy();

    vi.advanceTimersByTime(50);
    expect(internal.missedHeartbeatAcks).toBe(1);
    expect(onMissedAcks).not.toHaveBeenCalled();

    // Interval fires another ping; miss again to hit the limit.
    vi.advanceTimersByTime(1_000);
    vi.advanceTimersByTime(50);
    expect(internal.missedHeartbeatAcks).toBe(2);
    expect(onMissedAcks).toHaveBeenCalledTimes(1);

    stopHeartbeat(internal);
  });

  it("ignores ACK with mismatched pingId and accepts a matching ACK", () => {
    const internal = createInternalState(reconnectConfig);
    const sendMessage = vi.fn();
    startHeartbeat(internal, baseConfig(), sendMessage);
    const pending = internal.pendingPingId;
    expect(pending).toBeTruthy();

    handleHeartbeatAck(internal, "wrong-id");
    expect(internal.pendingPingId).toBe(pending);
    expect(internal.missedHeartbeatAcks).toBe(0);

    handleHeartbeatAck(internal, pending ?? undefined);
    expect(internal.pendingPingId).toBeNull();
    expect(internal.lastHeartbeatAckAt).toBeTypeOf("number");

    stopHeartbeat(internal);
  });

  it("accepts ACK without pingId when a ping is pending", () => {
    const internal = createInternalState(reconnectConfig);
    startHeartbeat(internal, baseConfig(), vi.fn());
    handleHeartbeatAck(internal, undefined);
    expect(internal.pendingPingId).toBeNull();
    stopHeartbeat(internal);
  });

  it("default onMissedAcks closes an open socket", () => {
    const internal = createInternalState(reconnectConfig);
    const close = vi.fn();
    internal.socket = { close } as unknown as WebSocket;

    startHeartbeat(
      internal,
      {
        ...baseConfig(),
        heartbeatMissedAckLimit: 1,
        heartbeatAckTimeoutMs: 20,
      },
      vi.fn(),
    );
    vi.advanceTimersByTime(20);
    expect(close).toHaveBeenCalled();
    stopHeartbeat(internal);
  });

  it("clearHeartbeatAckTimeout is a no-op when unset", () => {
    const internal = createInternalState(reconnectConfig);
    clearHeartbeatAckTimeout(internal);
    expect(internal.heartbeatAckTimeoutId).toBeNull();
  });
});
