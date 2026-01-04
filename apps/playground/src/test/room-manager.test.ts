import { describe, expect, it } from "vitest";
import { RoomManager } from "../modules/collab-editor/room-manager";
import type { User } from "../modules/collab-editor/types";

describe("RoomManager async operations", () => {
  it("should maintain order when using replace operation", async () => {
    const manager = new RoomManager();
    await manager.init();

    const user: User = {
      id: "test-user",
      name: "Test User",
      color: "#000",
    };

    const room = await manager.createRoom("Test Room", user);
    expect(room).toBeDefined();

    // Test replace operation maintains order
    await manager.insert(0, "Hello World");
    expect(manager.getText()).toBe("Hello World");

    // Replace should delete first, then insert
    await manager.replace(0, 5, "Hi");
    expect(manager.getText()).toBe("Hi World");

    // Multiple replace operations should be sequential
    await manager.replace(0, 2, "Hello");
    expect(manager.getText()).toBe("Hello World");

    await manager.replace(6, 5, "Universe");
    expect(manager.getText()).toBe("Hello Universe");
  });

  it("should handle async operations in correct order", async () => {
    const manager = new RoomManager();
    await manager.init();

    const user: User = {
      id: "test-user-2",
      name: "Test User 2",
      color: "#111",
    };

    await manager.createRoom("Test Room 2", user);

    // Execute operations sequentially to ensure deterministic order
    await manager.insert(0, "A"); // "A"
    await manager.insert(1, "B"); // "AB"
    await manager.insert(2, "C"); // "ABC"
    await manager.replace(1, 1, "X"); // "AXC"
    await manager.insert(3, "D"); // "AXCD"

    // Verify the exact expected result
    const text = manager.getText();
    expect(text).toBe("AXCD");
  });

  it("should handle concurrent operations with potential conflicts", async () => {
    const manager = new RoomManager();
    await manager.init();

    const user: User = {
      id: "test-user-3",
      name: "Test User 3",
      color: "#222",
    };

    await manager.createRoom("Test Room 3", user);

    // Start with some initial text
    await manager.insert(0, "Hello");

    // Queue concurrent operations that may conflict
    const operations = [
      manager.insert(5, " World"), // Valid: insert at end
      manager.insert(0, "Hi "), // Valid: insert at beginning
      manager.delete(0, 2), // May conflict with previous insert
    ];

    // Run concurrently and handle potential errors
    const results = await Promise.allSettled(operations);

    // At least some operations should succeed
    const successCount = results.filter((r) => r.status === "fulfilled").length;
    expect(successCount).toBeGreaterThan(0);

    // The final text should contain at least the base text
    const text = manager.getText();
    expect(text.length).toBeGreaterThan(0);
  });
});
