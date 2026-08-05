import { describe, expect, it } from "vitest";
import { createRoomId, resolveRoomId } from "./room";

describe("room", () => {
  it("creates unique 12-character URL-safe room identifiers", () => {
    const ids = Array.from({ length: 8 }, createRoomId);

    expect(ids).toHaveLength(new Set(ids).size);
    for (const id of ids) {
      expect(id).toHaveLength(12);
      expect(id).toMatch(/^[a-zA-Z0-9_-]+$/);
    }
  });

  it("derives requested rooms while retaining the generated fallback", () => {
    const generatedRoom = "generated-room";

    expect(
      [undefined, "room-a", "room-b", undefined].map((requestedRoom) =>
        resolveRoomId(requestedRoom, generatedRoom),
      ),
    ).toEqual([generatedRoom, "room-a", "room-b", generatedRoom]);
  });
});
