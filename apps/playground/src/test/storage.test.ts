import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalStorage } from "../modules/collab-editor/storage";
import type { Room } from "../modules/collab-editor/types";

describe("LocalStorage IDBRequest handling", () => {
  let storage: LocalStorage;

  beforeEach(async () => {
    storage = new LocalStorage();
    // Properly initialize IndexedDB to avoid falling back to localStorage
    await storage.init();
  });

  afterEach(async () => {
    // Clean up test data and close connections for test isolation
    if (storage) {
      await storage.clear();
      await storage.close();
    }

    // Additionally, delete the test database completely
    if ("indexedDB" in window) {
      await new Promise<void>((resolve, reject) => {
        const deleteReq = indexedDB.deleteDatabase("collab-editor");
        deleteReq.onsuccess = () => resolve();
        deleteReq.onerror = () => reject(deleteReq.error);
        deleteReq.onblocked = () => {
          console.warn("Database deletion blocked");
          resolve(); // Continue anyway
        };
      });
    }
  });

  it("should properly wait for IndexedDB operations to complete", async () => {
    // This test verifies that our wrapRequest helper works correctly
    // by ensuring saveRoom actually waits for the DB write
    const room: Room = {
      id: `test-room-${Date.now()}`,
      name: "Test Room",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    // Without proper IDBRequest wrapping, this would not wait
    await storage.saveRoom(room);

    // Verify the room was actually saved
    const savedRoom = await storage.getRoom(room.id);
    expect(savedRoom).toEqual(room);
  });

  it("should use IndexedDB when available, not localStorage fallback", async () => {
    // Skip this test if IndexedDB is not available in the test environment
    if (!("indexedDB" in window)) {
      console.log(
        "Skipping IndexedDB test - not available in test environment",
      );
      return;
    }

    const room: Room = {
      id: `test-room-${Date.now()}`,
      name: "Test IndexedDB Room",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await storage.saveRoom(room);

    // Check that localStorage doesn't have the room (proving we used IndexedDB)
    const localStorageRooms = localStorage.getItem("collab-rooms");
    if (localStorageRooms) {
      const rooms = JSON.parse(localStorageRooms);
      expect(rooms[room.id]).toBeUndefined();
    }

    // But the room should be retrievable via the storage API
    const savedRoom = await storage.getRoom(room.id);
    expect(savedRoom).toEqual(room);
  });

  it("should properly clean up between tests", async () => {
    // Create a room
    const room1: Room = {
      id: "cleanup-test-room",
      name: "Cleanup Test",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await storage.saveRoom(room1);
    const saved = await storage.getRoom(room1.id);
    expect(saved).toEqual(room1);

    // Clear storage
    await storage.clear();

    // Room should be gone
    const afterClear = await storage.getRoom(room1.id);
    expect(afterClear).toBeNull();
  });
});
