import { describe, expect, it } from "vitest";
import { createPresenceRoomStore, handlePresenceFrame } from "./presence-room";
import { frame, session, user } from "./presence-room.test-helpers";

describe("presence update publishing and bounds", () => {
  it("publishes normalized allowlisted updates", () => {
    const store = createPresenceRoomStore();
    handlePresenceFrame(
      store,
      "room-a",
      frame("join", { user: user("c1", "ada", 0) }, "c1")!,
      session(),
    );
    const result = handlePresenceFrame(
      store,
      "room-a",
      frame(
        "presence:update",
        {
          connectionId: "c1",
          userId: "ada",
          clock: 1,
          updates: {
            name: "Ada",
            injected: "drop-me",
          },
        },
        "c1",
      )!,
      session(),
    );
    expect(result.publish?.payload).toEqual({
      connectionId: "c1",
      userId: "ada",
      clock: 1,
      updates: { name: "Ada" },
    });
  });

  it("drops oversized allowlisted update payloads", () => {
    const store = createPresenceRoomStore({ maxUpdateBytes: 32 });
    handlePresenceFrame(
      store,
      "room-a",
      frame("join", { user: user("c1", "ada", 0) }, "c1")!,
      session(),
    );
    const result = handlePresenceFrame(
      store,
      "room-a",
      frame(
        "presence:update",
        {
          connectionId: "c1",
          userId: "ada",
          clock: 1,
          updates: { name: "x".repeat(100) },
        },
        "c1",
      )!,
      session(),
    );
    expect(result.publish).toBeNull();
  });

  it("drops oversized unknown fields before allowlist filtering", () => {
    const store = createPresenceRoomStore({ maxUpdateBytes: 64 });
    handlePresenceFrame(
      store,
      "room-a",
      frame("join", { user: user("c1", "ada", 0) }, "c1")!,
      session(),
    );
    const result = handlePresenceFrame(
      store,
      "room-a",
      frame(
        "presence:update",
        {
          connectionId: "c1",
          userId: "ada",
          clock: 1,
          updates: {
            name: "Ada",
            blob: "y".repeat(200),
          },
        },
        "c1",
      )!,
      session(),
    );
    expect(result.publish).toBeNull();
  });

  it("drops multibyte text exceeding the UTF-8 byte limit", () => {
    const store = createPresenceRoomStore({ maxUpdateBytes: 48 });
    handlePresenceFrame(
      store,
      "room-a",
      frame("join", { user: user("c1", "ada", 0) }, "c1")!,
      session(),
    );
    const emojiName = "🙂".repeat(20);
    expect(
      new TextEncoder().encode(JSON.stringify({ name: emojiName })).length,
    ).toBeGreaterThan(48);
    const result = handlePresenceFrame(
      store,
      "room-a",
      frame(
        "presence:update",
        {
          connectionId: "c1",
          userId: "ada",
          clock: 1,
          updates: { name: emojiName },
        },
        "c1",
      )!,
      session(),
    );
    expect(result.publish).toBeNull();
  });
});
