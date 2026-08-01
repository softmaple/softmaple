import { describe, expect, it } from "vitest";
import { createRoomIdentity, createRoomPresenceAdapter } from "./presence";

describe("room presence", () => {
  it("derives a stable label and palette color from a tab id", () => {
    expect(createRoomIdentity("a-fixed-1234")).toEqual({
      userId: "a-fixed-1234",
      name: "Peer 1234",
      color: expect.stringMatching(/^#[0-9A-F]{6}$/),
    });
    expect(createRoomIdentity("a-fixed-1234")).toEqual(
      createRoomIdentity("a-fixed-1234"),
    );
  });

  it("uses an isolated presence channel for each room", () => {
    const identity = createRoomIdentity("peer-a");
    const first = createRoomPresenceAdapter("room-a", identity);
    const second = createRoomPresenceAdapter("room-b", identity);

    expect(first).not.toBe(second);
    expect(first.getConnectionState()).toBe("disconnected");
    expect(second.getConnectionState()).toBe("disconnected");
  });
});
