import { describe, it, expect } from "vitest";
import { EgWalkerReplica, createEgWalkerReplica } from "../core/replica";
import { OPERATION_TYPE } from "../constants/operation-types";
import { EventAlreadyExistsError } from "../graph/event-graph";
import type { GraphEvent, SerializedGraphInput } from "../types";

describe("EgWalkerReplica", () => {
  describe("insert", () => {
    it("should insert text at valid index", () => {
      const api = new EgWalkerReplica("r1", "");
      api.insert(0, "Hello");
      expect(api.getText()).toBe("Hello");
    });

    it("should insert text in middle of document", () => {
      const api = new EgWalkerReplica("r1", "Hello World");
      api.insert(5, " Beautiful");
      expect(api.getText()).toBe("Hello Beautiful World");
    });

    it("should handle empty insert as no-op", () => {
      const api = new EgWalkerReplica("r1", "Hello");
      api.insert(2, "");
      expect(api.getText()).toBe("Hello");
    });

    it("should throw error for negative index", () => {
      const api = new EgWalkerReplica("r1", "Hello");
      expect(() => api.insert(-1, "x")).toThrow("Index -1 out of bounds");
    });

    it("should throw error for index beyond document length", () => {
      const api = new EgWalkerReplica("r1", "Hello");
      expect(() => api.insert(10, "x")).toThrow("Index 10 out of bounds");
    });
  });

  describe("delete", () => {
    it("should delete text at valid index", () => {
      const api = new EgWalkerReplica("r1", "Hello World");
      api.delete(5, 6);
      expect(api.getText()).toBe("Hello");
    });

    it("should handle zero-length delete as no-op", () => {
      const api = new EgWalkerReplica("r1", "Hello");
      api.delete(2, 0);
      expect(api.getText()).toBe("Hello");
    });

    it("should handle negative length delete as no-op", () => {
      const api = new EgWalkerReplica("r1", "Hello");
      api.delete(2, -1);
      expect(api.getText()).toBe("Hello");
    });

    it("should throw error for negative index", () => {
      const api = new EgWalkerReplica("r1", "Hello");
      expect(() => api.delete(-1, 2)).toThrow("Index -1 out of bounds");
    });

    it("should throw error when delete range exceeds document length", () => {
      const api = new EgWalkerReplica("r1", "Hello");
      expect(() => api.delete(3, 5)).toThrow(
        "Delete range [3, 8) exceeds document length 5",
      );
    });
  });

  describe("getDocument", () => {
    it("should return document state with text", () => {
      const api = new EgWalkerReplica("r1", "Hello");
      const state = api.getDocument();
      expect(state.text).toBe("Hello");
    });
  });

  describe("getText", () => {
    it("should return current text", () => {
      const api = new EgWalkerReplica("r1", "Hello");
      expect(api.getText()).toBe("Hello");
    });
  });

  describe("serialize/deserialize", () => {
    it("should serialize document state", () => {
      const api = new EgWalkerReplica("r1", "Hello");
      api.insert(5, " World");
      const serialized = api.serialize();
      expect(serialized.text).toBe("Hello World");
      expect(serialized.eventGraph).toBeDefined();
    });

    it("should deserialize document state", () => {
      const api = EgWalkerReplica.deserialize({
        text: "Hello",
        eventGraph: null as unknown as SerializedGraphInput,
      });
      expect(api.getText()).toBe("Hello");
    });
  });

  describe("duplicate event handling", () => {
    it("ignores duplicate local events without throwing", () => {
      const api = new EgWalkerReplica("r1", "");
      // @ts-expect-error - swap eventGraph.addEvent for the duplicate branch
      const originalAddEvent = api.eventGraph.addEvent.bind(api.eventGraph);
      // @ts-expect-error - same
      api.eventGraph.addEvent = (event: GraphEvent) => {
        throw new EventAlreadyExistsError(event.id);
      };

      expect(() => api.insert(0, "Hello")).not.toThrow();
      expect(api.getText()).toBe("");

      // @ts-expect-error - restore
      api.eventGraph.addEvent = originalAddEvent;
    });

    it("ignores duplicate remote events without throwing", () => {
      const api = new EgWalkerReplica("r1", "");
      const event: GraphEvent = {
        id: "remote:1",
        parentVersion: new Set(),
        operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "Hello" },
        timestamp: Date.now(),
      };

      api.applyRemoteEvent(event);
      expect(api.getText()).toBe("Hello");

      expect(() => api.applyRemoteEvent(event)).not.toThrow();
      expect(api.getText()).toBe("Hello");
    });
  });

  describe("exportEventGraph", () => {
    it("should export all events", () => {
      const api = new EgWalkerReplica("r1", "");
      api.insert(0, "Hello");
      api.insert(5, " World");
      const events = api.exportEventGraph();
      expect(events.length).toBe(2);
    });
  });

  describe("fromEventGraph", () => {
    it("should create API from event graph", () => {
      const events: GraphEvent[] = [
        {
          id: "r1:0",
          parentVersion: new Set(),
          operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "Hello" },
          timestamp: Date.now(),
        },
        {
          id: "r1:1",
          parentVersion: new Set(["r1:0"]),
          operation: { type: OPERATION_TYPE.INSERT, index: 5, text: " World" },
          timestamp: Date.now() + 1,
        },
      ];

      const api = EgWalkerReplica.fromEventGraph("r2", events);
      expect(api.getText()).toBe("Hello World");
    });
  });

  describe("out-of-order remote delivery", () => {
    it("buffers events whose parents have not yet arrived", () => {
      const api = new EgWalkerReplica("r1", "");
      const root: GraphEvent = {
        id: "alice:0",
        parentVersion: new Set(),
        operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "AB" },
        timestamp: 1,
      };
      const child: GraphEvent = {
        id: "alice:1",
        parentVersion: new Set(["alice:0"]),
        operation: { type: OPERATION_TYPE.INSERT, index: 2, text: "C" },
        timestamp: 2,
      };

      api.applyRemoteEvent(child);
      expect(api.getText()).toBe("");
      expect(api.getPendingRemoteCount()).toBe(1);

      api.applyRemoteEvent(root);
      expect(api.getText()).toBe("ABC");
      expect(api.getPendingRemoteCount()).toBe(0);
    });

    it("flushes a chain of pending events when the root finally arrives", () => {
      const api = new EgWalkerReplica("r1", "");
      const events: GraphEvent[] = [
        {
          id: "a:0",
          parentVersion: new Set(),
          operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "A" },
          timestamp: 1,
        },
        {
          id: "a:1",
          parentVersion: new Set(["a:0"]),
          operation: { type: OPERATION_TYPE.INSERT, index: 1, text: "B" },
          timestamp: 2,
        },
        {
          id: "a:2",
          parentVersion: new Set(["a:1"]),
          operation: { type: OPERATION_TYPE.INSERT, index: 2, text: "C" },
          timestamp: 3,
        },
      ];

      api.applyRemoteEvent(events[2]!);
      api.applyRemoteEvent(events[1]!);
      expect(api.getText()).toBe("");
      expect(api.getPendingRemoteCount()).toBe(2);

      api.applyRemoteEvent(events[0]!);
      expect(api.getText()).toBe("ABC");
      expect(api.getPendingRemoteCount()).toBe(0);
    });
  });
});

describe("createEgWalkerReplica", () => {
  it("should create API instance", () => {
    const api = createEgWalkerReplica("r1", "Hello");
    expect(api.getText()).toBe("Hello");
  });

  it("should create API with empty text by default", () => {
    const api = createEgWalkerReplica("r1");
    expect(api.getText()).toBe("");
  });
});

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

  it("applies sequential remote events incrementally without replaying history", () => {
    // Sequential remote events whose parents always extend the engine's
    // current version take the cheap incremental path — only the new event
    // is processed each time.
    const api = new EgWalkerReplica("r1");
    const history: GraphEvent[] = [];
    let parent: Set<string> = new Set();
    for (let i = 0; i < 50; i++) {
      const event: GraphEvent = {
        id: `alice:${i}`,
        parentVersion: parent,
        operation: { type: OPERATION_TYPE.INSERT, index: i, text: "x" },
        timestamp: i,
      };
      history.push(event);
      parent = new Set([event.id]);
    }

    for (const event of history) {
      api.applyRemoteEvent(event);
    }

    const stats = api.getReplayStats();
    // Only the very first event cold-starts the engine via fullReplay; every
    // subsequent event extends the current frontier and applies incrementally.
    expect(stats.fullReplays).toBe(1);
    expect(stats.incrementalApplies).toBe(history.length - 1);
    // No retreats on a strictly-forward linear history.
    expect(stats.engineRetreats).toBe(0);
    expect(api.getText()).toBe("x".repeat(history.length));
  });

  it("replays only the post-checkpoint suffix when a concurrent branch arrives off a long linear history", () => {
    // Acceptance criterion for issue #664: build a long linear history, then
    // deliver a concurrent branch rooted at the latest critical version. The
    // replica must replay just the divergent suffix from a critical-version
    // checkpoint instead of re-walking the whole graph.
    const api = new EgWalkerReplica("r1");
    const linear: GraphEvent[] = [];
    let parent: Set<string> = new Set();
    for (let i = 0; i < 50; i++) {
      const event: GraphEvent = {
        id: `alice:${i}`,
        parentVersion: parent,
        operation: { type: OPERATION_TYPE.INSERT, index: i, text: "x" },
        timestamp: i,
      };
      linear.push(event);
      parent = new Set([event.id]);
    }
    for (const event of linear) {
      api.applyRemoteEvent(event);
    }
    const tail: GraphEvent = linear[linear.length - 1]!;

    // Local edit on top of the linear tail. Sibling concurrent edit below.
    api.insert(api.getText().length, "L");
    const statsBeforeMerge = api.getReplayStats();

    // Concurrent remote event rooted at the same parent as the local edit —
    // engine.currentVersion is the local event but the remote's parents
    // point at the linear tail, so a retreat is required.
    api.applyRemoteEvent({
      id: "bob:0",
      parentVersion: new Set([tail.id]),
      operation: {
        type: OPERATION_TYPE.INSERT,
        index: linear.length,
        text: "R",
      },
      timestamp: linear.length + 1,
    });

    const stats = api.getReplayStats();
    // Bounded replay: no new full replay was triggered for the merge.
    expect(stats.fullReplays).toBe(statsBeforeMerge.fullReplays);
    // Exactly one partial replay covered the merge.
    expect(stats.partialReplays).toBe(statsBeforeMerge.partialReplays + 1);
    // Scope check: the engine seeded by the partial replay processes only
    // the two post-checkpoint events (local "L" + remote "R"), not all 52.
    expect(stats.engineRetreats + stats.engineAdvances).toBeLessThanOrEqual(2);
    // Convergence sanity: both inserts present, linear prefix intact.
    expect(api.getText().startsWith("x".repeat(linear.length))).toBe(true);
    expect(api.getText().includes("L")).toBe(true);
    expect(api.getText().includes("R")).toBe(true);
  });

  it("falls back to full replay only when no critical checkpoint dominates the merge", () => {
    // Two concurrent root inserts share no critical-version ancestor (the
    // empty version isn't critical once any event exists), so the replica
    // legitimately falls back to a full replay in topological order.
    const api = new EgWalkerReplica("r1");
    api.applyRemoteEvent({
      id: "alice:0",
      parentVersion: new Set(),
      operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "A" },
      timestamp: 1,
    });
    const before = api.getReplayStats();
    api.applyRemoteEvent({
      id: "bob:0",
      parentVersion: new Set(),
      operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "B" },
      timestamp: 2,
    });
    const after = api.getReplayStats();
    expect(after.fullReplays).toBe(before.fullReplays + 1);
    expect(after.partialReplays).toBe(before.partialReplays);
    expect(api.getText().includes("A")).toBe(true);
    expect(api.getText().includes("B")).toBe(true);
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
