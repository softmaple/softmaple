import Dexie from "dexie";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalStorage } from "../modules/collab-editor/storage";
import type { Room } from "../modules/collab-editor/types";

// Mock IndexedDB for tests
import "fake-indexeddb/auto";

describe("LocalStorage with Dexie", () => {
  let storage: LocalStorage;

  beforeEach(async () => {
    storage = new LocalStorage();
    // Initialize Dexie database
    await storage.init();
  });

  afterEach(async () => {
    // Clean up test data and close connections for test isolation
    if (storage) {
      await storage.clearAll();
      storage.close();
    }

    // Delete the test database completely
    await Dexie.delete("collab-editor-v2");
  });

  it("should properly save and retrieve rooms with Dexie", async () => {
    // This test verifies that Dexie operations work correctly
    const room: Room = {
      id: `test-room-${Date.now()}`,
      name: "Test Room",
      createdBy: "test-user",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    // Save room using Dexie
    await storage.saveRoom(room);

    // Verify the room was actually saved
    const savedRoom = await storage.getRoom(room.id);
    expect(savedRoom).toEqual(room);
  });

  it("should retrieve rooms by user", async () => {
    const room: Room = {
      id: `test-room-${Date.now()}`,
      name: "User Room",
      createdBy: "test-user-123",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await storage.saveRoom(room);

    // Get rooms by user
    const userRooms = await storage.getRoomsByUser("test-user-123");
    expect(userRooms).toHaveLength(1);
    expect(userRooms[0]).toEqual(room);
  });

  it("should handle concurrent operations without errors", async () => {
    // Test that concurrent saves work correctly
    const rooms = await Promise.all(
      new Array(5).fill(null).map(async (_, i) => {
        const room: Room = {
          id: `concurrent-room-${i}`,
          name: `Concurrent Room ${i}`,
          createdBy: "test-user",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        await storage.saveRoom(room);
        return room;
      }),
    );

    // Verify all rooms were saved
    for (const room of rooms) {
      const savedRoom = await storage.getRoom(room.id);
      expect(savedRoom).toEqual(room);
    }
  });

  it("should handle missing room gracefully", async () => {
    const room = await storage.getRoom("non-existent-room-id");
    expect(room).toBeUndefined();
  });

  it("should delete a room and its associated data", async () => {
    const room: Room = {
      id: `room-to-delete-${Date.now()}`,
      name: "Room to Delete",
      createdBy: "test-user",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await storage.saveRoom(room);

    // Verify it was saved
    let savedRoom = await storage.getRoom(room.id);
    expect(savedRoom).toEqual(room);

    // Delete the room
    await storage.deleteRoom(room.id);

    // Verify it was deleted
    savedRoom = await storage.getRoom(room.id);
    expect(savedRoom).toBeUndefined();
  });

  it("should clean up all data when clear is called", async () => {
    const room: Room = {
      id: `room-to-clear-${Date.now()}`,
      name: "Room to Clear",
      createdBy: "test-user",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await storage.saveRoom(room);
    await storage.clearAll();

    const savedRoom = await storage.getRoom(room.id);
    expect(savedRoom).toBeUndefined();
  });
});
