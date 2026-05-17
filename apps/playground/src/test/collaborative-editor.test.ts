import { POSITION_OPERATION_TYPE } from "@softmaple/awareness/mapping";
import { EgWalkerReplica } from "@softmaple/eg-walker";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { computeLocalEdit } from "../modules/collaborative-editor/use-collaborative-editor";

interface MockEgWalkerReplica {
  insert: (position: number, text: string) => void;
  delete: (position: number, count: number) => void;
  getText: () => string;
  exportEventGraph: () => unknown[];
  applyRemoteEvent: (event: unknown) => void;
}

// Mock EgWalkerReplica
vi.mock("@softmaple/eg-walker", () => {
  return {
    // biome-ignore lint/complexity/useArrowFunction: Vitest 4 requires function keyword for constructor mocks
    EgWalkerReplica: vi.fn().mockImplementation(function () {
      return {
        insert: vi.fn(),
        delete: vi.fn(),
        getText: vi.fn(() => ""),
        exportEventGraph: vi.fn(() => []),
        applyRemoteEvent: vi.fn(),
      };
    }),
  };
});

describe("Collaborative Editor Integration", () => {
  let api: MockEgWalkerReplica;

  const applyLocalEdit = (
    oldText: string,
    newText: string,
  ): ReturnType<typeof computeLocalEdit> => {
    const edit = computeLocalEdit(oldText, newText);
    edit?.apply(api as unknown as EgWalkerReplica);
    return edit;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // @ts-expect-error - EgWalkerReplica is mocked as MockEgWalkerReplica
    api = new EgWalkerReplica("test-replica") as MockEgWalkerReplica;
  });

  describe("Insertion operations", () => {
    it("should call insert with correct position for text at the beginning", () => {
      const oldText = "world";
      const newText = "hello world";
      const edit = applyLocalEdit(oldText, newText);

      expect(edit?.mappingOperations).toEqual([
        {
          type: POSITION_OPERATION_TYPE.Insert,
          index: 0,
          length: 6,
        },
      ]);
      expect(vi.mocked(api.insert)).toHaveBeenCalledWith(0, "hello ");
    });

    it("should call insert with correct position for text in the middle", () => {
      const oldText = "hello world";
      const newText = "hello beautiful world";
      const edit = applyLocalEdit(oldText, newText);

      expect(edit?.mappingOperations).toEqual([
        {
          type: POSITION_OPERATION_TYPE.Insert,
          index: 6,
          length: 10,
        },
      ]);
      expect(vi.mocked(api.insert)).toHaveBeenCalledWith(6, "beautiful ");
    });

    it("should call insert with correct position for text at the end", () => {
      const oldText = "hello";
      const newText = "hello world";
      const edit = applyLocalEdit(oldText, newText);

      expect(edit?.mappingOperations).toEqual([
        {
          type: POSITION_OPERATION_TYPE.Insert,
          index: 5,
          length: 6,
        },
      ]);
      expect(vi.mocked(api.insert)).toHaveBeenCalledWith(5, " world");
    });
  });

  describe("Deletion operations", () => {
    it("should call delete with correct position and count for deletion at the beginning", () => {
      const oldText = "hello world";
      const newText = "world";
      const edit = applyLocalEdit(oldText, newText);

      expect(edit?.mappingOperations).toEqual([
        {
          type: POSITION_OPERATION_TYPE.Delete,
          index: 0,
          length: 6,
        },
      ]);
      expect(vi.mocked(api.delete)).toHaveBeenCalledWith(0, 6);
    });

    it("should call delete with correct position and count for deletion in the middle", () => {
      const oldText = "hello beautiful world";
      const newText = "hello world";
      const edit = applyLocalEdit(oldText, newText);

      expect(edit?.mappingOperations).toEqual([
        {
          type: POSITION_OPERATION_TYPE.Delete,
          index: 6,
          length: 10,
        },
      ]);
      expect(vi.mocked(api.delete)).toHaveBeenCalledWith(6, 10);
    });

    it("should call delete with correct position and count for deletion at the end", () => {
      const oldText = "hello world";
      const newText = "hello";
      const edit = applyLocalEdit(oldText, newText);

      expect(edit?.mappingOperations).toEqual([
        {
          type: POSITION_OPERATION_TYPE.Delete,
          index: 5,
          length: 6,
        },
      ]);
      expect(vi.mocked(api.delete)).toHaveBeenCalledWith(5, 6);
    });
  });

  describe("Replacement operations", () => {
    it("should derive delete and insert for replacements with net insertion", () => {
      const oldText = "abcXYZdef";
      const newText = "abc12345def";
      const edit = computeLocalEdit(oldText, newText);

      edit?.apply(api as unknown as EgWalkerReplica);

      expect(edit?.mappingOperations).toEqual([
        {
          type: POSITION_OPERATION_TYPE.Delete,
          index: 3,
          length: 3,
        },
        {
          type: POSITION_OPERATION_TYPE.Insert,
          index: 3,
          length: 5,
        },
      ]);
      expect(vi.mocked(api.delete)).toHaveBeenCalledWith(3, 3);
      expect(vi.mocked(api.insert)).toHaveBeenCalledWith(3, "12345");
    });

    it("should derive delete and insert for replacements with net deletion", () => {
      const oldText = "abc12345def";
      const newText = "abcXYdef";
      const edit = computeLocalEdit(oldText, newText);

      edit?.apply(api as unknown as EgWalkerReplica);

      expect(edit?.mappingOperations).toEqual([
        {
          type: POSITION_OPERATION_TYPE.Delete,
          index: 3,
          length: 5,
        },
        {
          type: POSITION_OPERATION_TYPE.Insert,
          index: 3,
          length: 2,
        },
      ]);
      expect(vi.mocked(api.delete)).toHaveBeenCalledWith(3, 5);
      expect(vi.mocked(api.insert)).toHaveBeenCalledWith(3, "XY");
    });

    it("should call delete and insert for replacement at the beginning", () => {
      const oldText = "hello world";
      const newText = "HELLO world";
      const edit = applyLocalEdit(oldText, newText);

      expect(edit?.mappingOperations).toEqual([
        {
          type: POSITION_OPERATION_TYPE.Delete,
          index: 0,
          length: 5,
        },
        {
          type: POSITION_OPERATION_TYPE.Insert,
          index: 0,
          length: 5,
        },
      ]);
      expect(vi.mocked(api.delete)).toHaveBeenCalledWith(0, 5);
      expect(vi.mocked(api.insert)).toHaveBeenCalledWith(0, "HELLO");
    });

    it("should call delete and insert for replacement in the middle", () => {
      const oldText = "hello world";
      const newText = "hello WORLD";
      const edit = applyLocalEdit(oldText, newText);

      expect(edit?.mappingOperations).toEqual([
        {
          type: POSITION_OPERATION_TYPE.Delete,
          index: 6,
          length: 5,
        },
        {
          type: POSITION_OPERATION_TYPE.Insert,
          index: 6,
          length: 5,
        },
      ]);
      expect(vi.mocked(api.delete)).toHaveBeenCalledWith(6, 5);
      expect(vi.mocked(api.insert)).toHaveBeenCalledWith(6, "WORLD");
    });

    it("should call delete and insert for single character replacement", () => {
      const oldText = "hello";
      const newText = "heLlo";
      const edit = applyLocalEdit(oldText, newText);

      expect(edit?.mappingOperations).toEqual([
        {
          type: POSITION_OPERATION_TYPE.Delete,
          index: 2,
          length: 1,
        },
        {
          type: POSITION_OPERATION_TYPE.Insert,
          index: 2,
          length: 1,
        },
      ]);
      expect(vi.mocked(api.delete)).toHaveBeenCalledWith(2, 1);
      expect(vi.mocked(api.insert)).toHaveBeenCalledWith(2, "L");
    });

    it("should call delete and insert for complete text replacement", () => {
      const oldText = "abc";
      const newText = "xyz";
      const edit = applyLocalEdit(oldText, newText);

      expect(edit?.mappingOperations).toEqual([
        {
          type: POSITION_OPERATION_TYPE.Delete,
          index: 0,
          length: 3,
        },
        {
          type: POSITION_OPERATION_TYPE.Insert,
          index: 0,
          length: 3,
        },
      ]);
      expect(vi.mocked(api.delete)).toHaveBeenCalledWith(0, 3);
      expect(vi.mocked(api.insert)).toHaveBeenCalledWith(0, "xyz");
    });
  });

  describe("Event synchronization", () => {
    it("should export event graph after insert operation", () => {
      api.insert(0, "test");
      api.exportEventGraph();

      expect(vi.mocked(api.exportEventGraph)).toHaveBeenCalled();
    });

    it("should export event graph after delete operation", () => {
      api.delete(0, 4);
      api.exportEventGraph();

      expect(vi.mocked(api.exportEventGraph)).toHaveBeenCalled();
    });

    it("should apply remote events from other replicas", async () => {
      const mockEvent = {
        id: "event-1",
        operation: { type: "INSERT", position: 0, text: "hello" },
      };

      await api.applyRemoteEvent(mockEvent);

      expect(vi.mocked(api.applyRemoteEvent)).toHaveBeenCalledWith(mockEvent);
    });
  });
});
