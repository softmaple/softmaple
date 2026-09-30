import { describe, expect, it } from "vitest";

import { OPERATION_TYPE } from "../constants/operation-types";
import {
  createCausalEventBatchBuilder,
  type CausalEventBatch,
} from "../core/causal-event-batch";
import { MAX_RETAINED_CHECKPOINTS } from "../core/internals/critical-checkpoint-store";
import { EgWalkerReplica } from "../core/replica";
import { PersistentUtf16Rope } from "../text/persistent-utf16-rope";
import { APPLY_REMOTE_EVENT_STATUS, type GraphEvent } from "../types";
import { cloneEvent } from "./test-helpers";

const insertEvent = (
  id: string,
  parents: ReadonlyArray<string>,
  index: number,
  text: string,
  timestamp = 0,
): GraphEvent => ({
  id,
  parentVersion: new Set(parents),
  operation: { type: OPERATION_TYPE.INSERT, index, text },
  timestamp,
});

const deleteEvent = (
  id: string,
  parents: ReadonlyArray<string>,
  index: number,
  length: number,
): GraphEvent => ({
  id,
  parentVersion: new Set(parents),
  operation: { type: OPERATION_TYPE.DELETE, index, length },
  timestamp: 0,
});

/** `a:first` … typing `text` at the end of a document of length `index`. */
const typing = (
  replicaId: string,
  first: number,
  parent: string | null,
  index: number,
  text: string,
): GraphEvent[] =>
  Array.from(text, (character, offset) =>
    insertEvent(
      `${replicaId}:${first + offset}`,
      offset === 0
        ? parent === null
          ? []
          : [parent]
        : [`${replicaId}:${first + offset - 1}`],
      index + offset,
      character,
      first + offset,
    ),
  );

const observableState = (replica: EgWalkerReplica): unknown => ({
  serialized: replica.serialize(),
  text: replica.getText(),
  pending: replica.getPendingRemoteCount(),
  stats: replica.getReplayStats(),
});

const packedTailEvents = (replica: EgWalkerReplica): number =>
  (
    replica as unknown as {
      eventGraph: { getObjectTailStructureStats(): { tailEvents: number } };
    }
  ).eventGraph.getObjectTailStructureStats().tailEvents;

const perEventReference = (
  events: ReadonlyArray<GraphEvent>,
  replicaId = "reference",
): {
  readonly replica: EgWalkerReplica;
  readonly results: ReadonlyArray<unknown>;
} => {
  const replica = new EgWalkerReplica(replicaId);
  const results = events.map((event) =>
    replica.applyRemoteEvent(cloneEvent(event)),
  );
  return { replica, results };
};

describe("applyRemoteEvents on an exact chain", () => {
  it("stores the chain in packed columns and reports each event's operation", () => {
    const events = [
      ...typing("a", 0, null, 0, "hello"),
      deleteEvent("a:5", ["a:4"], 1, 3),
      insertEvent("a:6", ["a:5"], 1, ""),
      deleteEvent("a:7", ["a:6"], 0, 0),
      ...typing("a", 8, "a:7", 2, "!?"),
    ];
    const replica = new EgWalkerReplica("receiver");

    const result = replica.applyRemoteEvents(events);

    const reference = perEventReference(events);
    expect(result.results).toEqual(reference.results);
    expect(result.operations).toEqual(
      reference.results.flatMap((entry) => {
        const operation = (entry as { operation?: unknown }).operation;
        return operation === null || operation === undefined ? [] : [operation];
      }),
    );
    expect(result.results[6]).toEqual({
      status: APPLY_REMOTE_EVENT_STATUS.Integrated,
      operation: null,
    });
    expect(replica.getText()).toBe("ho!?");
    expect(replica.exportEventGraph()).toEqual(
      reference.replica.exportEventGraph(),
    );
    expect(replica.getFrontier()).toEqual(new Set(["a:9"]));
    expect(packedTailEvents(replica)).toBe(0);
    expect(replica.getReplayStats()).toMatchObject({
      fullReplays: 0,
      incrementalApplies: events.length,
    });
  });

  it("edits the persistent rope only for the checkpoint window of a long chain", () => {
    // Inserts at the start never coalesce, so each is its own rope edit.
    const characters = Array.from({ length: 1_000 }, (_, index) =>
      String.fromCharCode(0x21 + (index % 94)),
    );
    const events = characters.map((character, index) =>
      insertEvent(
        `a:${index}`,
        index === 0 ? [] : [`a:${index - 1}`],
        0,
        character,
        index,
      ),
    );
    const replica = new EgWalkerReplica("receiver");

    PersistentUtf16Rope.resetInstrumentation();
    const result = replica.applyRemoteEvents(events);
    const rope = PersistentUtf16Rope.getInstrumentation();

    expect(result.results).toHaveLength(events.length);
    expect(replica.getText()).toBe([...characters].reverse().join(""));
    expect(packedTailEvents(replica)).toBe(0);
    expect(rope.joins).toBeLessThanOrEqual(MAX_RETAINED_CHECKPOINTS);
  });

  it("keeps appending batches to the packed chain and merges a concurrent edit", () => {
    const events = typing("a", 0, null, 0, "x".repeat(300));
    const replica = new EgWalkerReplica("receiver");
    for (let start = 0; start < events.length; start += 64) {
      replica.applyRemoteEvents(events.slice(start, start + 64));
    }
    expect(packedTailEvents(replica)).toBe(0);

    const concurrent = insertEvent("b:0", ["a:99"], 50, "B");
    replica.applyRemoteEvent(concurrent);

    const reference = perEventReference([...events, concurrent]);
    expect(replica.getText()).toBe(reference.replica.getText());
    expect(replica.exportEventGraph()).toEqual(
      reference.replica.exportEventGraph(),
    );
  });

  it("appends to the object tail once the graph is not one packed chain", () => {
    const replica = new EgWalkerReplica("receiver");
    replica.applyRemoteEvent(insertEvent("seed:0", [], 0, "s"));
    const events = typing("a", 0, "seed:0", 1, "abc");

    const result = replica.applyRemoteEvents(events);

    expect(result.operations).toEqual([
      { type: OPERATION_TYPE.INSERT, index: 1, length: 1 },
      { type: OPERATION_TYPE.INSERT, index: 2, length: 1 },
      { type: OPERATION_TYPE.INSERT, index: 3, length: 1 },
    ]);
    expect(replica.getText()).toBe("sabc");
    expect(packedTailEvents(replica)).toBe(4);
  });

  it("stores events with fractional timestamps in the object tail", () => {
    const events = typing("a", 0, null, 0, "ab").map((event, index) => ({
      ...event,
      timestamp: index + 0.5,
    }));
    const replica = new EgWalkerReplica("receiver");

    replica.applyRemoteEvents(events);

    expect(replica.exportEventGraph().map((event) => event.timestamp)).toEqual([
      0.5, 1.5,
    ]);
    expect(packedTailEvents(replica)).toBe(2);
  });

  it("detaches stored events from the caller's objects", () => {
    const events = typing("a", 0, null, 0, "ab");
    const replica = new EgWalkerReplica("receiver");
    replica.applyRemoteEvents(events);

    (events[1]!.parentVersion as Set<string>).add("forged:0");
    (events[1]!.operation as { text: string }).text = "mutated";

    expect(replica.exportEventGraph()[1]).toEqual(
      insertEvent("a:1", ["a:0"], 1, "b", 1),
    );
  });

  it("marks repeated events as duplicates through the general path", () => {
    const events = typing("a", 0, null, 0, "abc");
    const replica = new EgWalkerReplica("receiver");
    replica.applyRemoteEvents(events.slice(0, 2));

    const result = replica.applyRemoteEvents(events);

    expect(result.results.map((entry) => entry.status)).toEqual([
      APPLY_REMOTE_EVENT_STATUS.Duplicate,
      APPLY_REMOTE_EVENT_STATUS.Duplicate,
      APPLY_REMOTE_EVENT_STATUS.Integrated,
    ]);
    expect(replica.getText()).toBe("abc");
  });

  it.each([
    {
      name: "an event that repeats an earlier ID",
      events: [
        insertEvent("a:0", [], 0, "a"),
        insertEvent("a:1", ["a:0"], 1, "b"),
        insertEvent("a:0", ["a:1"], 2, "c"),
      ],
      error: /conflicts with an existing ID/,
    },
    {
      name: "an event that names itself as parent",
      events: [
        insertEvent("a:0", [], 0, "a"),
        insertEvent("a:0", ["a:0"], 1, "b"),
      ],
      error: /cannot parent itself/,
    },
    {
      name: "a delete past a document emptied by the run before it",
      events: [
        insertEvent("a:0", [], 0, "ab"),
        deleteEvent("a:1", ["a:0"], 0, 2),
        deleteEvent("a:2", ["a:1"], 0, 1),
      ],
      error: "Index 0 out of bounds [0, -1] for document of length 0",
    },
    {
      // Long enough that the deletes fall before the per-event checkpoint
      // window, where the fast path coalesces them.
      name: "a coalesced delete past the emptied document",
      events: [
        insertEvent("a:0", [], 0, "ab"),
        deleteEvent("a:1", ["a:0"], 0, 2),
        deleteEvent("a:2", ["a:1"], 0, 1),
        ...typing("a", 3, "a:2", 0, "z".repeat(40)),
      ],
      error: "Index 0 out of bounds [0, -1] for document of length 0",
    },
    {
      name: "a lone surrogate",
      events: [
        insertEvent("a:0", [], 0, "a"),
        insertEvent("a:1", ["a:0"], 1, "\uD83D"),
      ],
      error: /lone high surrogate/,
    },
  ])("reports $name as before and changes nothing", ({ events, error }) => {
    const replica = new EgWalkerReplica("receiver");
    replica.applyRemoteEvent(insertEvent("seed:0", [], 0, ""));
    const rooted = events.map((event, index) =>
      index === 0 ? { ...event, parentVersion: new Set(["seed:0"]) } : event,
    );
    const before = observableState(replica);

    expect(() => replica.applyRemoteEvents(rooted)).toThrow(error);
    expect(observableState(replica)).toEqual(before);
  });

  it("rolls back a packed chain after a late invalid event", () => {
    const replica = new EgWalkerReplica("receiver");
    replica.applyRemoteEvents(typing("a", 0, null, 0, "ab"));
    const before = observableState(replica);
    const events = [
      ...typing("a", 2, "a:1", 2, "c".repeat(40)),
      insertEvent("a:42", ["a:41"], 99, "x"),
    ];

    expect(() => replica.applyRemoteEvents(events)).toThrow(/out of bounds/);
    expect(observableState(replica)).toEqual(before);
    replica.applyRemoteEvents(typing("a", 2, "a:1", 2, "cd"));
    expect(replica.getText()).toBe("abcd");
  });
});

describe("applyCausalBatch on an exact chain", () => {
  it("extends a packed chain across batches", () => {
    const events = typing("a", 0, null, 0, "abcdef");
    const replica = new EgWalkerReplica("causal");
    for (const slice of [events.slice(0, 2), events.slice(2)]) {
      const builder = createCausalEventBatchBuilder(slice.length);
      for (const event of slice) {
        if (event.operation.type === OPERATION_TYPE.INSERT) {
          builder.appendInsert(
            event.id,
            event.parentVersion,
            event.operation.index,
            event.operation.text,
            event.timestamp,
          );
        }
      }
      replica.applyCausalBatch(builder.finish());
    }

    expect(replica.getText()).toBe("abcdef");
    expect(packedTailEvents(replica)).toBe(0);
    expect(replica.exportEventGraph()).toEqual(
      perEventReference(events).replica.exportEventGraph(),
    );
  });

  it("packs non-canonical IDs next to canonical runs", () => {
    const ids = [
      // No numeric suffix, a leading zero, more than 16 digits, and a
      // replica ID that contains ":".
      "draft",
      "a:007",
      "a:12345678901234567",
      "team:a:0",
      "team:a:1",
      ...Array.from({ length: 40 }, (_, offset) => `a:${offset}`),
      "a:0x",
    ];
    let length = 0;
    const events = chainOf(ids, (offset) => {
      if (offset % 4 === 3) {
        length--;
        return { type: OPERATION_TYPE.DELETE, index: 0, length: 1 };
      }
      return { type: OPERATION_TYPE.INSERT, index: length++, text: "x" };
    });
    const replica = new EgWalkerReplica("causal");

    replica.applyCausalBatch(toCausalBatch(events.slice(0, 20)));
    replica.applyCausalBatch(toCausalBatch(events.slice(20)));

    const reference = perEventReference(events).replica;
    expect(replica.getText()).toBe(reference.getText());
    expect(replica.exportEventGraph()).toEqual(reference.exportEventGraph());
    expect(replica.getFrontier()).toEqual(new Set(["a:0x"]));
    expect(packedTailEvents(replica)).toBe(0);
  });

  it.each([
    { name: "within the batch", repeated: "a:3" },
    { name: "from an earlier batch", repeated: "a:1" },
  ])("rejects an ID repeated $name and changes nothing", ({ repeated }) => {
    const replica = new EgWalkerReplica("causal");
    replica.applyCausalBatch(toCausalBatch(typing("a", 0, null, 0, "ab")));
    const before = observableState(replica);
    const events = [
      ...typing("a", 2, "a:1", 2, "c".repeat(40)),
      insertEvent(repeated, ["a:41"], 42, "x"),
    ];
    const batch = toCausalBatch(events);

    expect(() => replica.applyCausalBatch(batch)).toThrow(
      `Event ${repeated} already exists`,
    );
    expect(observableState(replica)).toEqual(before);
    replica.applyCausalBatch(toCausalBatch(typing("a", 2, "a:1", 2, "cd")));
    expect(replica.getText()).toBe("abcd");
    expect(packedTailEvents(replica)).toBe(0);
  });

  it("keeps events with fractional timestamps in the object tail", () => {
    const events = typing("a", 0, null, 0, "ab").map((event, index) => ({
      ...event,
      timestamp: index + 0.5,
    }));
    const replica = new EgWalkerReplica("causal");

    replica.applyCausalBatch(toCausalBatch(events));

    expect(replica.getText()).toBe("ab");
    expect(replica.exportEventGraph().map((event) => event.timestamp)).toEqual([
      0.5, 1.5,
    ]);
    expect(packedTailEvents(replica)).toBe(2);
  });
});

/** Events that each name only the event before them. */
const chainOf = (
  ids: ReadonlyArray<string>,
  operationAt: (offset: number) => GraphEvent["operation"],
): GraphEvent[] =>
  ids.map((id, offset) => ({
    id,
    parentVersion: new Set(offset === 0 ? [] : [ids[offset - 1]!]),
    operation: operationAt(offset),
    timestamp: offset,
  }));

const toCausalBatch = (events: ReadonlyArray<GraphEvent>): CausalEventBatch => {
  const builder = createCausalEventBatchBuilder(events.length);
  for (const { id, parentVersion, operation, timestamp } of events) {
    if (operation.type === OPERATION_TYPE.INSERT) {
      builder.appendInsert(
        id,
        parentVersion,
        operation.index,
        operation.text,
        timestamp,
      );
    } else {
      builder.appendDelete(
        id,
        parentVersion,
        operation.index,
        operation.length,
        timestamp,
      );
    }
  }
  return builder.finish();
};
