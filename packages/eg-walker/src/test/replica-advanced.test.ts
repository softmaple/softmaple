import { describe, it, expect } from "vitest";
import { EgWalkerReplica } from "../core/replica";
import { OPERATION_TYPE } from "../constants/operation-types";
import type { GraphEvent, SerializedGraphInput } from "../types";

describe("EgWalkerReplica - Edge cases and error handling", () => {
  it("should propagate non-duplicate errors in applyLocalOperation", () => {
    const api = new EgWalkerReplica("r1");
    // @ts-expect-error - swap eventGraph.addEvent for the failing branch
    const originalAddEvent = api.eventGraph.addEvent.bind(api.eventGraph);
    // @ts-expect-error - same
    api.eventGraph.addEvent = () => {
      throw new Error("Some other error");
    };

    expect(() => api.insert(0, "test")).toThrow("Some other error");

    // @ts-expect-error - restore
    api.eventGraph.addEvent = originalAddEvent;
  });

  it("should propagate non-duplicate errors in applyRemoteEvent", () => {
    const api = new EgWalkerReplica("r1");

    const event: GraphEvent = {
      id: "r2:0",
      parentVersion: new Set(),
      operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "test" },
      timestamp: Date.now(),
    };

    // @ts-expect-error - swap eventGraph.addEvent for the failing branch
    const originalAddEvent = api.eventGraph.addEvent.bind(api.eventGraph);
    // @ts-expect-error - same
    api.eventGraph.addEvent = () => {
      throw new Error("Network error");
    };

    expect(() => api.applyRemoteEvent(event)).toThrow("Network error");

    // @ts-expect-error - restore
    api.eventGraph.addEvent = originalAddEvent;
  });

  it("should handle deserialize with eventGraph data", () => {
    const api = new EgWalkerReplica("r1", "Test");
    const serialized = api.serialize();

    const deserialized = EgWalkerReplica.deserialize(serialized);
    expect(deserialized.getText()).toBe("Test");
  });

  it("should deserialize JSON-persisted serialized API data", () => {
    const api = new EgWalkerReplica("r1", "");
    api.insert(0, "A");
    api.insert(1, "B");

    const parsed = JSON.parse(JSON.stringify(api.serialize())) as unknown as {
      text: string;
      eventGraph: SerializedGraphInput;
    };
    const deserialized = EgWalkerReplica.deserialize(parsed);

    expect(deserialized.getText()).toBe("AB");
  });

  it("should reject invalid direct local operations before committing", () => {
    const api = new EgWalkerReplica("r1", "Hello");
    const readSeq = (): number =>
      // @ts-expect-error - read private nextSequenceNumber for regression coverage
      api.nextSequenceNumber as number;

    expect(readSeq()).toBe(0);

    expect(() =>
      api.applyLocalOperation({
        type: OPERATION_TYPE.INSERT,
        index: 10,
        text: "!",
      }),
    ).toThrow("Index 10 out of bounds");
    expect(api.exportEventGraph()).toHaveLength(0);
    expect(readSeq()).toBe(0);

    expect(() =>
      api.applyLocalOperation({
        type: OPERATION_TYPE.DELETE,
        index: 3,
        length: 5,
      }),
    ).toThrow("Delete range [3, 8) exceeds document length 5");
    expect(api.exportEventGraph()).toHaveLength(0);
    expect(readSeq()).toBe(0);

    api.applyLocalOperation({
      type: OPERATION_TYPE.INSERT,
      index: 5,
      text: "!",
    });
    expect(api.exportEventGraph()[0]?.id).toBe("r1:0");
    expect(api.getText()).toBe("Hello!");
    expect(readSeq()).toBe(1);
  });

  it("should deserialize empty graph state without stored initial text metadata", () => {
    const deserialized = EgWalkerReplica.deserialize({
      text: "Fallback",
      eventGraph: {
        version: new Set(),
        events: [],
        metadata: {},
      },
    });

    expect(deserialized.getText()).toBe("Fallback");
  });

  it("infers nextSequenceNumber for metadata-less restores with existing replica ids", () => {
    const api = new EgWalkerReplica("r1");
    api.insert(0, "A");
    api.insert(1, "B");
    const serialized = api.serialize();

    const restored = EgWalkerReplica.deserialize(
      {
        ...serialized,
        eventGraph: {
          ...serialized.eventGraph,
          metadata: {},
        },
      },
      "r1",
    );

    restored.insert(2, "C");

    expect(restored.getText()).toBe("ABC");
    expect(restored.exportEventGraph().some((e) => e.id === "r1:2")).toBe(true);
  });

  it("restores broad concurrent metadata-less graphs with a single replay when text matches", () => {
    const eventCount = 64;
    const events = Array.from({ length: eventCount }, (_unused, index) => ({
      id: `r1:${index}`,
      operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "x" },
      parentVersion: [],
      timestamp: index,
    }));

    const restored = EgWalkerReplica.deserialize(
      {
        text: "x".repeat(eventCount),
        eventGraph: {
          version: events.map((event) => event.id),
          events,
          metadata: {},
        },
      },
      "r1",
    );

    restored.insert(eventCount, "!");

    expect(restored.getReplayStats().fullReplays).toBe(1);
    expect(restored.getText()).toBe(`${"x".repeat(eventCount)}!`);
    expect(
      restored.exportEventGraph().some((event) => event.id === "r1:64"),
    ).toBe(true);
  });

  it("ignores non-numeric sequence suffixes when inferring nextSequenceNumber", () => {
    // Hits the Number.isInteger=false branch in inferNextSequenceNumber.
    const api = new EgWalkerReplica("r1");
    api.applyRemoteEvent({
      id: "r1:notanumber",
      parentVersion: new Set(),
      operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "X" },
      timestamp: 1,
    });

    const restored = EgWalkerReplica.deserialize(
      // Drop persisted nextSequenceNumber metadata so the API has to infer it.
      {
        ...api.serialize(),
        eventGraph: {
          ...api.serialize().eventGraph,
          metadata: {},
        },
      },
      "r1",
    );

    restored.insert(1, "Y");
    // Inferred sequence number should be 0 because "notanumber" is skipped.
    expect(restored.exportEventGraph().some((e) => e.id === "r1:0")).toBe(true);
  });

  it("should fail atomically when the event ID sequence is exhausted", () => {
    // Arrange
    const source = new EgWalkerReplica("r1");
    const restored = EgWalkerReplica.fromPortableSnapshot(
      {
        ...source.createPortableSnapshot(),
        nextSequenceNumber: Number.MAX_SAFE_INTEGER,
      },
      "r1",
    );

    // Act
    restored.insert(0, "A");
    const insertAfterExhaustion = () => restored.insert(1, "B");

    // Assert
    expect(restored.exportEventGraph().map(({ id }) => id)).toEqual([
      `r1:${Number.MAX_SAFE_INTEGER}`,
    ]);
    expect(insertAfterExhaustion).toThrow(/event ID sequence.*exhausted/);
    expect(restored.getText()).toBe("A");
    expect(restored.exportEventGraph()).toHaveLength(1);
  });

  it("should detect exhaustion inferred from a metadata-less graph", () => {
    // Arrange
    const eventId = `r1:${Number.MAX_SAFE_INTEGER}`;
    const restored = EgWalkerReplica.deserialize(
      {
        text: "A",
        eventGraph: {
          version: [eventId],
          events: [
            {
              id: eventId,
              parentVersion: [],
              operation: {
                type: OPERATION_TYPE.INSERT,
                index: 0,
                text: "A",
              },
              timestamp: 0,
            },
          ],
          metadata: {},
        },
      },
      "r1",
    );

    // Act
    const insert = () => restored.insert(1, "B");

    // Assert
    expect(insert).toThrow(/event ID sequence.*exhausted/);
    expect(restored.getText()).toBe("A");
    expect(restored.exportEventGraph()).toHaveLength(1);
  });

  describe("surrogate pair boundaries", () => {
    it("rejects inserts that land between surrogate halves", () => {
      const api = new EgWalkerReplica("r1", "😀");
      // "😀".length === 2 (high + low surrogate). Index 1 falls mid-pair.
      expect(() => api.insert(1, "X")).toThrow(
        /falls between surrogate halves/,
      );
      expect(() => api.delete(1, 0)).not.toThrow(); // length 0 short-circuits
      expect(() => api.delete(0, 1)).toThrow(/falls between surrogate halves/);
      // Valid boundaries still work.
      expect(() => api.insert(0, "A")).not.toThrow();
      expect(() => api.insert(api.getText().length, "Z")).not.toThrow();
    });

    it("rejects local inserts whose payload contains a lone surrogate", () => {
      const api = new EgWalkerReplica("r1", "hello");
      // Lone high surrogate (U+D83D, the first half of "😀") with no low
      // partner — would otherwise materialise as a standalone CRDT item
      // and surface as an unpaired surrogate in getText().
      expect(() => api.insert(0, "\uD83D")).toThrow(
        /lone high surrogate.*at index 0/,
      );
      // Lone low surrogate.
      expect(() => api.insert(0, "\uDE00")).toThrow(
        /lone low surrogate.*at index 0/,
      );
      // High surrogate followed by a non-surrogate is also ill-formed.
      expect(() => api.insert(0, "\uD83DA")).toThrow(/lone high surrogate/);
      // Valid surrogate pair (emoji) is accepted.
      expect(() => api.insert(0, "😀")).not.toThrow();
      expect(api.getText().startsWith("😀")).toBe(true);
    });

    it("rejects initial document text containing a lone surrogate", () => {
      expect(() => new EgWalkerReplica("r1", "\uD83Dhello")).toThrow(
        /initial document text contains a lone high surrogate/,
      );
      expect(() => new EgWalkerReplica("r1", "hello\uDE00")).toThrow(
        /initial document text contains a lone low surrogate/,
      );
      // A well-formed emoji at any position is fine.
      expect(() => new EgWalkerReplica("r1", "hi 😀!")).not.toThrow();
    });

    it("rejects remote events whose insert payload contains a lone surrogate", () => {
      const api = new EgWalkerReplica("r1");
      expect(() =>
        api.applyRemoteEvent({
          id: "bob:0",
          parentVersion: new Set(),
          operation: {
            type: OPERATION_TYPE.INSERT,
            index: 0,
            text: "\uD83D",
          },
          timestamp: 1,
        }),
      ).toThrow(
        /remote event bob:0 insert text contains a lone high surrogate/,
      );
      // A well-formed remote insert with a paired emoji passes.
      expect(() =>
        api.applyRemoteEvent({
          id: "bob:1",
          parentVersion: new Set(),
          operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "😀" },
          timestamp: 2,
        }),
      ).not.toThrow();
      expect(api.getText()).toBe("😀");
    });

    it("rejects remote events with unsafe indexes or delete lengths before graph mutation", () => {
      const api = new EgWalkerReplica("r1", "hello");
      expect(() =>
        api.applyRemoteEvent({
          id: "bob:index",
          parentVersion: new Set(),
          operation: {
            type: OPERATION_TYPE.INSERT,
            index: 1.5,
            text: "X",
          },
          timestamp: 0,
        }),
      ).toThrow(/remote event bob:index has invalid operation index 1.5/);
      expect(() =>
        api.applyRemoteEvent({
          id: "bob:0",
          parentVersion: new Set(),
          operation: {
            type: OPERATION_TYPE.DELETE,
            index: 0,
            length: Number.NaN,
          },
          timestamp: 1,
        }),
      ).toThrow(/remote event bob:0 has invalid delete length/);
      expect(() =>
        api.applyRemoteEvent({
          id: "bob:1",
          parentVersion: new Set(),
          operation: {
            type: OPERATION_TYPE.DELETE,
            index: 0,
            length: -1,
          },
          timestamp: 2,
        }),
      ).toThrow(/remote event bob:1 has invalid delete length -1/);
      expect(() =>
        api.applyRemoteEvent({
          id: "bob:2",
          parentVersion: new Set(),
          operation: {
            type: OPERATION_TYPE.DELETE,
            index: 0,
            length: 1.5,
          },
          timestamp: 3,
        }),
      ).toThrow(/remote event bob:2 has invalid delete length 1.5/);

      expect(api.exportEventGraph()).toHaveLength(0);
      expect(api.getText()).toBe("hello");

      api.applyRemoteEvent({
        id: "bob:3",
        parentVersion: new Set(),
        operation: {
          type: OPERATION_TYPE.INSERT,
          index: 5,
          text: "!",
        },
        timestamp: 4,
      });
      expect(api.getText()).toBe("hello!");
    });

    it("keeps concurrent emoji operations from splitting surrogate pairs", () => {
      const api = new EgWalkerReplica("alice", "ab");

      // Insert emoji between a and b.
      api.insert(1, "😀");
      expect(api.getText()).toBe("a😀b");

      // Concurrent remote insert at the same anchor (parents = root). Engine
      // routes it through full replay; the resulting text must still be
      // valid UTF-16 (no lone surrogates).
      api.applyRemoteEvent({
        id: "bob:0",
        parentVersion: new Set(),
        operation: { type: OPERATION_TYPE.INSERT, index: 1, text: "Z" },
        timestamp: Date.now(),
      });

      const text = api.getText();
      // Each surrogate pair must remain adjacent.
      for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        if (code >= 0xd800 && code <= 0xdbff) {
          // High surrogate must be followed by a low surrogate.
          const next = text.charCodeAt(i + 1);
          expect(next).toBeGreaterThanOrEqual(0xdc00);
          expect(next).toBeLessThanOrEqual(0xdfff);
          i++;
        } else {
          // Lone low surrogate is a failure.
          expect(code < 0xdc00 || code > 0xdfff).toBe(true);
        }
      }
    });
  });

  it("ignores already-buffered remote events on re-delivery", () => {
    // Hits the bufferedEventIds.has(event.id) early-return branch in
    // tryAcceptRemoteEvent.
    const api = new EgWalkerReplica("r1");
    const child: GraphEvent = {
      id: "alice:1",
      parentVersion: new Set(["alice:0"]),
      operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "B" },
      timestamp: 2,
    };
    api.applyRemoteEvent(child);
    expect(api.getPendingRemoteCount()).toBe(1);
    // Re-deliver the same buffered event — should be a no-op.
    api.applyRemoteEvent(child);
    expect(api.getPendingRemoteCount()).toBe(1);

    // Then deliver the parent and verify both flush correctly.
    api.applyRemoteEvent({
      id: "alice:0",
      parentVersion: new Set(),
      operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "A" },
      timestamp: 1,
    });
    expect(api.getPendingRemoteCount()).toBe(0);
    expect(api.getText()).toBe("BA");
  });
});
