import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_RECONNECT_CONFIG } from "../types";
import {
  clearHeartbeatAckTimeouts,
  handleHeartbeatAck,
  startHeartbeat,
  stopHeartbeat,
} from "./connection";
import { createInternalState } from "./state";
import type { WebSocketAdapterConfig } from "./types";
import { DEFAULT_WS_CONFIG } from "./types";

const baseConfig = (
  overrides: Partial<WebSocketAdapterConfig> = {},
): WebSocketAdapterConfig => ({
  url: "ws://localhost",
  roomId: "room",
  userInfo: { userId: "u", name: "U", color: "#000" },
  connectionId: "c1",
  heartbeatIntervalMs: 1_000,
  heartbeatAckTimeoutMs: 50,
  heartbeatMissedAckLimit: 2,
  ...overrides,
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
    expect(internal.heartbeatAckTimeouts.size).toBe(1);

    vi.advanceTimersByTime(50);
    expect(internal.missedHeartbeatAcks).toBe(1);
    expect(onMissedAcks).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1_000);
    vi.advanceTimersByTime(50);
    expect(internal.missedHeartbeatAcks).toBe(2);
    expect(onMissedAcks).toHaveBeenCalledTimes(1);

    stopHeartbeat(internal);
  });

  it("retains prior ACK deadlines when interval is shorter than ack timeout", () => {
    const internal = createInternalState(reconnectConfig);
    const sendMessage = vi.fn();
    const onMissedAcks = vi.fn();

    startHeartbeat(
      internal,
      baseConfig({
        heartbeatIntervalMs: DEFAULT_WS_CONFIG.heartbeatIntervalMs,
        heartbeatAckTimeoutMs: DEFAULT_WS_CONFIG.heartbeatAckTimeoutMs,
        heartbeatMissedAckLimit: 2,
      }),
      sendMessage,
      onMissedAcks,
    );

    expect(internal.heartbeatAckTimeouts.size).toBe(1);
    // Next ping fires before the first ACK deadline expires.
    vi.advanceTimersByTime(DEFAULT_WS_CONFIG.heartbeatIntervalMs);
    expect(internal.heartbeatAckTimeouts.size).toBe(2);
    expect(sendMessage).toHaveBeenCalledTimes(2);

    // First ping's deadline fires (20s from t0 = 10s after second ping).
    vi.advanceTimersByTime(
      DEFAULT_WS_CONFIG.heartbeatAckTimeoutMs -
        DEFAULT_WS_CONFIG.heartbeatIntervalMs,
    );
    expect(internal.missedHeartbeatAcks).toBe(1);
    expect(onMissedAcks).not.toHaveBeenCalled();

    // Second ping's deadline fires.
    vi.advanceTimersByTime(DEFAULT_WS_CONFIG.heartbeatIntervalMs);
    expect(internal.missedHeartbeatAcks).toBe(2);
    expect(onMissedAcks).toHaveBeenCalledTimes(1);

    stopHeartbeat(internal);
  });

  it("ignores ACK with mismatched pingId and accepts a matching ACK", () => {
    const internal = createInternalState(reconnectConfig);
    const sendMessage = vi.fn();
    startHeartbeat(internal, baseConfig(), sendMessage);
    const [pending] = internal.heartbeatAckTimeouts.keys();
    expect(pending).toBeTruthy();

    handleHeartbeatAck(internal, "wrong-id");
    expect(internal.heartbeatAckTimeouts.has(pending!)).toBe(true);
    expect(internal.missedHeartbeatAcks).toBe(0);

    handleHeartbeatAck(internal, pending);
    expect(internal.heartbeatAckTimeouts.size).toBe(0);
    expect(internal.lastHeartbeatAckAt).toBeTypeOf("number");

    stopHeartbeat(internal);
  });

  it("accepts ACK without pingId by clearing all pending deadlines", () => {
    const internal = createInternalState(reconnectConfig);
    startHeartbeat(internal, baseConfig(), vi.fn());
    expect(internal.heartbeatAckTimeouts.size).toBe(1);
    handleHeartbeatAck(internal, undefined);
    expect(internal.heartbeatAckTimeouts.size).toBe(0);
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

  it("clearHeartbeatAckTimeouts is a no-op when empty", () => {
    const internal = createInternalState(reconnectConfig);
    clearHeartbeatAckTimeouts(internal);
    expect(internal.heartbeatAckTimeouts.size).toBe(0);
  });
});
