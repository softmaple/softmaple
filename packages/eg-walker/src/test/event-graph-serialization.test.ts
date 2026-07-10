import { describe, it, expect } from "vitest";
import { OPERATION_TYPE } from "../constants/operation-types";
import type { GraphEvent, EventId, SerializedGraphInput } from "../types";
import { EventGraph } from "../graph/event-graph";

describe("serialization", () => {
  it("should serialize and deserialize event graph", () => {
    const graph = new EventGraph();

    const event1: GraphEvent = {
      id: "event-1",
      timestamp: 100,
      parentVersion: new Set<EventId>(),
      operation: {
        type: OPERATION_TYPE.INSERT,
        index: 0,
        text: "Hello",
      },
    };

    const event2: GraphEvent = {
      id: "event-2",
      timestamp: 200,
      parentVersion: new Set<EventId>(["event-1"]),
      operation: {
        type: OPERATION_TYPE.INSERT,
        index: 5,
        text: "World",
      },
    };

    graph.addEvent(event1);
    graph.addEvent(event2);

    const serialized = graph.serialize();

    expect(serialized.version).toEqual(["event-2"]);
    expect(serialized.events).toHaveLength(2);

    const newGraph = EventGraph.deserialize(serialized);

    expect(newGraph.hasEvent("event-1")).toBe(true);
    expect(newGraph.hasEvent("event-2")).toBe(true);
    expect(newGraph.getEvent("event-2")?.parentVersion.has("event-1")).toBe(
      true,
    );
  });

  it("serializes graph versions as JSON-safe arrays", () => {
    const graph = new EventGraph();

    graph.addEvent({
      id: "event-1",
      timestamp: 100,
      parentVersion: new Set<EventId>(),
      operation: {
        type: OPERATION_TYPE.INSERT,
        index: 0,
        text: "Hello",
      },
    });
    graph.addEvent({
      id: "event-2",
      timestamp: 200,
      parentVersion: new Set<EventId>(["event-1"]),
      operation: {
        type: OPERATION_TYPE.INSERT,
        index: 5,
        text: "World",
      },
    });

    const parsed = JSON.parse(
      JSON.stringify(graph.serialize()),
    ) as unknown as SerializedGraphInput;
    const newGraph = EventGraph.deserialize(parsed);

    expect(parsed.version).toEqual(["event-2"]);
    expect(parsed.events[1]?.parentVersion).toEqual(["event-1"]);
    expect(newGraph.getEvent("event-2")?.parentVersion).toEqual(
      new Set(["event-1"]),
    );
  });

  it("should validate version during deserialization", () => {
    const invalidData: SerializedGraphInput = {
      version: new Set<EventId>(), // Empty version
      events: [],
      metadata: {},
    };

    // Should not throw with valid data structure
    const graph = EventGraph.deserialize(invalidData);
    expect(graph.getAllEvents()).toHaveLength(0);
  });

  it("should preserve metadata during serialization", () => {
    const graph = new EventGraph();

    const event: GraphEvent = {
      id: "event-1",
      timestamp: 100,
      parentVersion: new Set<EventId>(),
      operation: {
        type: OPERATION_TYPE.INSERT,
        index: 0,
        text: "Test",
      },
    };

    graph.addEvent(event);

    const serialized = graph.serialize();
    const modifiedSerialized = {
      ...serialized,
      metadata: { customField: "test-value" },
    };

    const newGraph = EventGraph.deserialize(modifiedSerialized);
    const reSerialized = newGraph.serialize();

    expect(reSerialized.metadata?.customField).toBe("test-value");
  });

  it("rejects a serialized version that is not the graph frontier", () => {
    expect(() =>
      EventGraph.deserialize({
        version: [],
        events: [
          {
            id: "root",
            timestamp: 1,
            parentVersion: [],
            operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "A" },
          },
        ],
      }),
    ).toThrow(/serialized version does not match graph frontier/);
  });

  it("should reject serialized graphs whose parents cannot be resolved", () => {
    const invalidData: SerializedGraphInput = {
      version: new Set<EventId>(["event-2"]),
      events: [
        {
          id: "event-2",
          timestamp: 200,
          parentVersion: new Set<EventId>(["missing-parent"]),
          operation: {
            type: OPERATION_TYPE.INSERT,
            index: 0,
            text: "B",
          },
        },
      ],
      metadata: {},
    };

    expect(() => EventGraph.deserialize(invalidData)).toThrow(
      "Cannot deserialize event graph with missing parents: missing-parent",
    );
  });

  it("should reject serialized graphs with duplicate event ids", () => {
    const event: GraphEvent = {
      id: "event-1",
      timestamp: 100,
      parentVersion: new Set<EventId>(),
      operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "A" },
    };

    expect(() =>
      EventGraph.deserialize({
        version: new Set<EventId>(),
        events: [event, event],
        metadata: {},
      }),
    ).toThrow(
      "Cannot deserialize event graph with duplicate event id: event-1",
    );
  });

  it("should reject serialized graphs containing a parent cycle", () => {
    // event-a parents on event-b, event-b parents on event-a — every parent
    // referenced is present in the payload, so the failure mode is a cycle,
    // not a missing parent.
    expect(() =>
      EventGraph.deserialize({
        version: new Set<EventId>(),
        events: [
          {
            id: "event-a",
            timestamp: 1,
            parentVersion: new Set<EventId>(["event-b"]),
            operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "A" },
          },
          {
            id: "event-b",
            timestamp: 2,
            parentVersion: new Set<EventId>(["event-a"]),
            operation: { type: OPERATION_TYPE.INSERT, index: 1, text: "B" },
          },
        ],
        metadata: {},
      }),
    ).toThrow(
      "Cannot deserialize event graph: cycle or unresolvable ordering detected",
    );
  });

  it("should reject serialized graphs containing a multi-event cycle", () => {
    // event-a → event-b → event-c → event-a, covering the path where a
    // cycle spans more than two nodes (the A↔B test above is the minimal
    // case).
    expect(() =>
      EventGraph.deserialize({
        version: new Set<EventId>(),
        events: [
          {
            id: "event-a",
            timestamp: 1,
            parentVersion: new Set<EventId>(["event-c"]),
            operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "A" },
          },
          {
            id: "event-b",
            timestamp: 2,
            parentVersion: new Set<EventId>(["event-a"]),
            operation: { type: OPERATION_TYPE.INSERT, index: 1, text: "B" },
          },
          {
            id: "event-c",
            timestamp: 3,
            parentVersion: new Set<EventId>(["event-b"]),
            operation: { type: OPERATION_TYPE.INSERT, index: 2, text: "C" },
          },
        ],
        metadata: {},
      }),
    ).toThrow(
      "Cannot deserialize event graph: cycle or unresolvable ordering detected",
    );
  });

  it("should reject serialized graphs containing a self-parent (degenerate cycle)", () => {
    expect(() =>
      EventGraph.deserialize({
        version: new Set<EventId>(),
        events: [
          {
            id: "self",
            timestamp: 1,
            parentVersion: new Set<EventId>(["self"]),
            operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "X" },
          },
        ],
        metadata: {},
      }),
    ).toThrow(
      "Cannot deserialize event graph: cycle or unresolvable ordering detected",
    );
  });
});

describe("normalizeEventIds strict input handling", () => {
  const root = (): GraphEvent => ({
    id: "root",
    timestamp: 1,
    parentVersion: new Set<EventId>(),
    operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "A" },
  });
  const child = (parentVersion: unknown): unknown => ({
    id: "child",
    timestamp: 2,
    parentVersion,
    operation: { type: OPERATION_TYPE.INSERT, index: 1, text: "B" },
  });

  it("accepts a Set instance for parentVersion (in-memory shape)", () => {
    const graph = EventGraph.deserialize({
      version: ["child"],
      events: [root(), child(new Set<EventId>(["root"])) as never] as never,
    });
    expect(graph.getEvent("child")?.parentVersion).toEqual(new Set(["root"]));
  });

  it("rejects a generic Iterable for parentVersion", () => {
    const iterableParents: Iterable<EventId> = {
      *[Symbol.iterator]() {
        yield "root";
      },
    };
    expect(() =>
      EventGraph.deserialize({
        version: ["child"],
        events: [root(), child(iterableParents) as never] as never,
      }),
    ).toThrow(/parents must be an array or Set/);
  });

  it("rejects non-iterable object parentVersion payloads", () => {
    expect(() =>
      EventGraph.deserialize({
        version: [],
        events: [{ ...root(), parentVersion: {} } as never] as never,
      }),
    ).toThrow(/parents must be an array or Set/);
  });

  it("rejects non-string and duplicate array parents", () => {
    expect(() =>
      EventGraph.deserialize({
        version: ["child"],
        events: [
          root(),
          child([42, "root", null] as unknown as EventId[]) as never,
        ] as never,
      }),
    ).toThrow(/non-string event ID/);
    expect(() =>
      EventGraph.deserialize({
        version: ["child"],
        events: [root(), child(["root", "root"]) as never] as never,
      }),
    ).toThrow(/duplicate event ID root/);
  });
});
