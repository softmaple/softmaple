import { describe, expect, it } from "vitest";
import { isRecord, parsePresenceEnvelope } from "./envelope";

describe("isRecord", () => {
  it("accepts plain objects and rejects arrays/null/primitives", () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord([])).toBe(false);
    expect(isRecord(null)).toBe(false);
    expect(isRecord("string")).toBe(false);
  });
});

describe("parsePresenceEnvelope", () => {
  it("parses a well-formed envelope, carrying payload only when present", () => {
    const withPayload = parsePresenceEnvelope({
      type: "join",
      roomId: "room-1",
      senderId: "connection-1",
      timestamp: 1_000,
      payload: { hello: "world" },
    });
    expect(withPayload).toEqual({
      type: "join",
      roomId: "room-1",
      senderId: "connection-1",
      timestamp: 1_000,
      payload: { hello: "world" },
    });

    const withoutPayload = parsePresenceEnvelope({
      type: "leave",
      roomId: "room-1",
      senderId: "connection-1",
      timestamp: 1_000,
    });
    expect(withoutPayload).not.toHaveProperty("payload");
  });

  it.each([
    ["a non-object value", "not-an-object"],
    ["an array", []],
    ["a missing type", { roomId: "r", senderId: "s", timestamp: 1 }],
    ["an empty type", { type: "", roomId: "r", senderId: "s", timestamp: 1 }],
    [
      "an over-long type",
      { type: "x".repeat(65), roomId: "r", senderId: "s", timestamp: 1 },
    ],
    ["a missing roomId", { type: "join", senderId: "s", timestamp: 1 }],
    [
      "an empty roomId",
      { type: "join", roomId: "", senderId: "s", timestamp: 1 },
    ],
    ["a missing senderId", { type: "join", roomId: "r", timestamp: 1 }],
    [
      "an empty senderId",
      { type: "join", roomId: "r", senderId: "", timestamp: 1 },
    ],
    [
      "a non-numeric timestamp",
      { type: "join", roomId: "r", senderId: "s", timestamp: "1" },
    ],
    [
      "a non-finite timestamp",
      { type: "join", roomId: "r", senderId: "s", timestamp: Number.NaN },
    ],
  ])("rejects %s", (_case, value) => {
    expect(() => parsePresenceEnvelope(value)).toThrow(
      "invalid presence envelope",
    );
  });
});
