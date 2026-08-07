import { describe, expect, it } from "vitest";
import {
  createPresenceRoomStore,
  handlePresenceFrame,
  parsePresenceMessage,
  PRESENCE_PROTOCOL_VERSION,
} from "./presence-room";
import { frame, session } from "./presence-room.test-helpers";

describe("presence message parsing", () => {
  it("parses valid frames and rejects malformed JSON", () => {
    expect(parsePresenceMessage("{")).toBeNull();
    expect(frame("heartbeat", { pingId: "p1" })?.type).toBe("heartbeat");
  });

  it("rejects non-finite timestamps and non-string wire fields", () => {
    expect(
      parsePresenceMessage(
        JSON.stringify({
          type: 1,
          roomId: "room-a",
          senderId: "c1",
          timestamp: 1_000,
        }),
      ),
    ).toBeNull();
    expect(
      parsePresenceMessage(
        JSON.stringify({
          type: "join",
          roomId: 42,
          senderId: "c1",
          timestamp: 1_000,
        }),
      ),
    ).toBeNull();
    expect(
      parsePresenceMessage(
        JSON.stringify({
          type: "join",
          roomId: "room-a",
          senderId: null,
          timestamp: 1_000,
        }),
      ),
    ).toBeNull();
    expect(
      parsePresenceMessage(
        JSON.stringify({
          type: "join",
          roomId: "room-a",
          senderId: "c1",
          timestamp: Number.NaN,
        }),
      ),
    ).toBeNull();
  });
});

describe("presence auth handshake", () => {
  it("replies auth_ok for valid protocol v2 auth frames", () => {
    const store = createPresenceRoomStore();
    const parsed = frame("auth", {
      token: "demo",
      protocolVersion: PRESENCE_PROTOCOL_VERSION,
      capabilities: { connectionId: true },
      connectionId: "c1",
      userId: "ada",
    });
    expect(parsed).not.toBeNull();
    const result = handlePresenceFrame(store, "room-a", parsed!);
    expect(result.outbound[0]?.type).toBe("auth_ok");
    expect(result.session).toEqual({ connectionId: "c1", userId: "ada" });
  });

  it("rejects auth frames with the wrong protocol version", () => {
    const store = createPresenceRoomStore();
    const parsed = frame("auth", {
      token: "demo",
      protocolVersion: 1,
      connectionId: "c1",
      userId: "ada",
    });
    const result = handlePresenceFrame(store, "room-a", parsed!);
    expect(result.outbound[0]?.type).toBe("auth_error");
    expect(result.session).toBeUndefined();
  });

  it("rejects empty auth tokens", () => {
    const store = createPresenceRoomStore();
    const parsed = frame("auth", {
      token: "",
      protocolVersion: PRESENCE_PROTOCOL_VERSION,
      connectionId: "c1",
      userId: "ada",
    });
    const result = handlePresenceFrame(store, "room-a", parsed!);
    expect(result.outbound[0]?.type).toBe("auth_error");
    expect(result.session).toBeUndefined();
  });
});

describe("presence frame routing guards", () => {
  it("ignores frames for a mismatched roomId", () => {
    const store = createPresenceRoomStore();
    const parsed = frame("heartbeat", { pingId: "p1" }, "c1", "other-room");
    const result = handlePresenceFrame(store, "room-a", parsed!, session());
    expect(result.outbound).toEqual([]);
    expect(result.publish).toBeNull();
  });

  it("echoes pingId on heartbeat:ack", () => {
    const store = createPresenceRoomStore();
    const result = handlePresenceFrame(
      store,
      "room-a",
      frame("heartbeat", { pingId: "ping-42" })!,
      session(),
    );
    expect(result.outbound[0]).toMatchObject({
      type: "heartbeat:ack",
      payload: { pingId: "ping-42" },
    });
  });
});
