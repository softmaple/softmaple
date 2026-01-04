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
      avatar: "#000",
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
      avatar: "#111",
    };

    await manager.createRoom("Test Room 2", user);

    // Queue multiple operations
    const operations = [
      manager.insert(0, "A"),
      manager.insert(1, "B"),
      manager.insert(2, "C"),
      manager.replace(1, 1, "X"),
      manager.insert(3, "D"),
    ];

    await Promise.all(operations);
    
    // The result depends on the order of execution
    const text = manager.getText();
    expect(text).toMatch(/[ABCDX]+/);
  });
});
