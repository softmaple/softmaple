import { beforeEach, describe, expect, it } from "vitest";
import { LocalStorage } from "../modules/collab-editor/storage";
import type { Room } from "../modules/collab-editor/types";

describe("LocalStorage IDBRequest handling", () => {
  let storage: LocalStorage;

  beforeEach(() => {
    storage = new LocalStorage();
  });

  it("should properly wait for IndexedDB operations to complete", async () => {
    // This test verifies that our wrapRequest helper works correctly
    // by ensuring saveRoom actually waits for the DB write
    const room: Room = {
      id: `test-room-${Date.now()}`,
      name: "Test Room",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ownerId: "test-user",
      participants: [],
    };

    // Without proper IDBRequest wrapping, this would not wait
    await storage.saveRoom(room);

    // Verify the room was actually saved
    const savedRoom = await storage.getRoom(room.id);
    expect(savedRoom).toEqual(room);
  });
});
