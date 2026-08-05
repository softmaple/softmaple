import { describe, expect, it } from "vitest";
import { createRoomId, resolveRoomId } from "./room";

describe("Lexical EG-walker demo", () => {
  it("creates URL-safe room identifiers", () => {
    expect(createRoomId()).toMatch(/^[a-zA-Z0-9_-]{8,64}$/);
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
