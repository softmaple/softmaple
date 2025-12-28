import { describe, it, expect, vi, beforeEach } from "vitest";
import { EgWalkerAPI } from "@softmaple/eg-walker";
import {
  findInsertPosition,
  findDeletePosition,
  findDifferingRange,
} from "../lib/text-diff";

// Mock EgWalkerAPI
vi.mock("@softmaple/eg-walker", () => {
  return {
    EgWalkerAPI: vi.fn().mockImplementation(() => ({
      insert: vi.fn(),
      delete: vi.fn(),
      getText: vi.fn(() => ""),
      exportEventGraph: vi.fn(() => []),
      applyRemoteEvent: vi.fn(),
    })),
  };
});

describe("Collaborative Editor Integration", () => {
  let api: any;

  beforeEach(() => {
    vi.clearAllMocks();
    api = new (EgWalkerAPI as any)("test-replica");
  });

  describe("Insertion operations", () => {
    it("should call insert with correct position for text at the beginning", () => {
      const oldText = "world";
      const newText = "hello world";
      const position = findInsertPosition(oldText, newText);
      const insertedText = newText.slice(
        position,
        position + (newText.length - oldText.length),
      );

      api.insert(position, insertedText);

      expect(api.insert).toHaveBeenCalledWith(0, "hello ");
    });

    it("should call insert with correct position for text in the middle", () => {
      const oldText = "hello world";
      const newText = "hello beautiful world";
      const position = findInsertPosition(oldText, newText);
      const insertedText = newText.slice(
        position,
        position + (newText.length - oldText.length),
      );

      api.insert(position, insertedText);

      expect(api.insert).toHaveBeenCalledWith(6, "beautiful ");
    });

    it("should call insert with correct position for text at the end", () => {
      const oldText = "hello";
      const newText = "hello world";
      const position = findInsertPosition(oldText, newText);
      const insertedText = newText.slice(
        position,
        position + (newText.length - oldText.length),
      );

      api.insert(position, insertedText);

      expect(api.insert).toHaveBeenCalledWith(5, " world");
    });
  });

  describe("Deletion operations", () => {
    it("should call delete with correct position and count for deletion at the beginning", () => {
      const oldText = "hello world";
      const newText = "world";
      const position = findDeletePosition(oldText, newText);
      const deleteCount = oldText.length - newText.length;

      api.delete(position, deleteCount);

      expect(api.delete).toHaveBeenCalledWith(0, 6);
    });

    it("should call delete with correct position and count for deletion in the middle", () => {
      const oldText = "hello beautiful world";
      const newText = "hello world";
      const position = findDeletePosition(oldText, newText);
      const deleteCount = oldText.length - newText.length;

      api.delete(position, deleteCount);

      expect(api.delete).toHaveBeenCalledWith(6, 10);
    });

    it("should call delete with correct position and count for deletion at the end", () => {
      const oldText = "hello world";
      const newText = "hello";
      const position = findDeletePosition(oldText, newText);
      const deleteCount = oldText.length - newText.length;

      api.delete(position, deleteCount);

      expect(api.delete).toHaveBeenCalledWith(5, 6);
    });
  });

  describe("Replacement operations", () => {
    it("should call delete and insert for replacement at the beginning", () => {
      const oldText = "hello world";
      const newText = "HELLO world";
      const { start, end } = findDifferingRange(oldText, newText);
      const deleteCount = end - start + 1;
      const replacementText = newText.slice(start, end + 1);

      api.delete(start, deleteCount);
      api.insert(start, replacementText);

      expect(api.delete).toHaveBeenCalledWith(0, 5);
      expect(api.insert).toHaveBeenCalledWith(0, "HELLO");
    });

    it("should call delete and insert for replacement in the middle", () => {
      const oldText = "hello world";
      const newText = "hello WORLD";
      const { start, end } = findDifferingRange(oldText, newText);
      const deleteCount = end - start + 1;
      const replacementText = newText.slice(start, end + 1);

      api.delete(start, deleteCount);
      api.insert(start, replacementText);

      expect(api.delete).toHaveBeenCalledWith(6, 5);
      expect(api.insert).toHaveBeenCalledWith(6, "WORLD");
    });

    it("should call delete and insert for single character replacement", () => {
      const oldText = "hello";
      const newText = "heLlo";
      const { start, end } = findDifferingRange(oldText, newText);
      const deleteCount = end - start + 1;
      const replacementText = newText.slice(start, end + 1);

      api.delete(start, deleteCount);
      api.insert(start, replacementText);

      expect(api.delete).toHaveBeenCalledWith(2, 1);
      expect(api.insert).toHaveBeenCalledWith(2, "L");
    });

    it("should call delete and insert for complete text replacement", () => {
      const oldText = "abc";
      const newText = "xyz";
      const { start, end } = findDifferingRange(oldText, newText);
      const deleteCount = end - start + 1;
      const replacementText = newText.slice(start, end + 1);

      api.delete(start, deleteCount);
      api.insert(start, replacementText);

      expect(api.delete).toHaveBeenCalledWith(0, 3);
      expect(api.insert).toHaveBeenCalledWith(0, "xyz");
    });
  });

  describe("Event synchronization", () => {
    it("should export event graph after insert operation", () => {
      api.insert(0, "test");
      api.exportEventGraph();

      expect(api.exportEventGraph).toHaveBeenCalled();
    });

    it("should export event graph after delete operation", () => {
      api.delete(0, 4);
      api.exportEventGraph();

      expect(api.exportEventGraph).toHaveBeenCalled();
    });

    it("should apply remote events from other replicas", async () => {
      const mockEvent = {
        id: "event-1",
        operation: { type: "INSERT", position: 0, text: "hello" },
      };

      await api.applyRemoteEvent(mockEvent);

      expect(api.applyRemoteEvent).toHaveBeenCalledWith(mockEvent);
    });
  });
});
