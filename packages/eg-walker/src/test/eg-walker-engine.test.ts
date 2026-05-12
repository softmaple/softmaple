import { describe, expect, it, vi } from "vitest";
import { OPERATION_TYPE } from "../constants/operation-types";
import lz4 from "lz4js";
import { CriticalVersionAnalyzer } from "../engine/critical-version";
import { EgWalker } from "../core/walker";
import { EgWalkerReplica } from "../core/replica";
import { EgWalkerEngine } from "../engine/eg-walker-engine";
import { EventGraph } from "../graph/event-graph";
import { PartialReplayManager } from "../engine/partial-replay";
import { IndexedSequence } from "../engine/indexed-sequence";
import { ColumnarEventGraphCodec } from "../graph/columnar-codec";
import type { GraphEvent } from "../types";

interface SequenceModelItem {
  readonly id: string;
  prepare: number;
  effect: number;
}

const createPrng = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
};

const visiblePositions = (
  items: ReadonlyArray<SequenceModelItem>,
  kind: "prepare" | "effect",
): number[] =>
  items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item[kind] === 1)
    .map(({ index }) => index);

describe("EgWalkerEngine", () => {
  it("transforms concurrent insertions from the paper's motivating example", () => {
    const events: GraphEvent[] = [
      {
        id: "alice:0",
        parentVersion: new Set(),
        operation: { type: OPERATION_TYPE.INSERT, index: 3, text: "l" },
        timestamp: 1,
      },
      {
        id: "bob:0",
        parentVersion: new Set(),
        operation: { type: OPERATION_TYPE.INSERT, index: 4, text: "!" },
        timestamp: 2,
      },
    ];

    const generated = new EgWalkerEngine().generate(events, "Helo");

    expect(generated.text).toBe("Hello!");
    expect(generated.transformedOperations).toEqual([
      { type: OPERATION_TYPE.INSERT, index: 3, text: "l" },
      { type: OPERATION_TYPE.INSERT, index: 5, text: "!" },
    ]);
    expect(generated.stats.retreatCount).toBe(1);
    expect(generated.stats.advanceCount).toBe(0);
  });

  it("treats overlapping concurrent deletes as idempotent effect deletes", () => {
    const events: GraphEvent[] = [
      {
        id: "alice:0",
        parentVersion: new Set(),
        operation: { type: OPERATION_TYPE.DELETE, index: 1, length: 3 },
        timestamp: 1,
      },
      {
        id: "bob:0",
        parentVersion: new Set(),
        operation: { type: OPERATION_TYPE.DELETE, index: 2, length: 2 },
        timestamp: 2,
      },
    ];

    const generated = new EgWalkerEngine().generate(events, "abcdef");

    expect(generated.text).toBe("aef");
  });

  it("handles empty inserts and deletes that run past visible prepare items", () => {
    const generated = new EgWalkerEngine().generate(
      [
        {
          id: "noop:0",
          parentVersion: new Set(),
          operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "" },
          timestamp: 1,
        },
        {
          id: "delete:0",
          parentVersion: new Set(["noop:0"]),
          operation: { type: OPERATION_TYPE.DELETE, index: 0, length: 4 },
          timestamp: 2,
        },
      ],
      "a",
    );

    expect(generated.text).toBe("");
    expect(generated.transformedOperations).toEqual([
      { type: OPERATION_TYPE.DELETE, index: 0, length: 1 },
    ]);
  });

  it("retreats and advances delete events while walking divergent versions", () => {
    const events: GraphEvent[] = [
      {
        id: "root:0",
        parentVersion: new Set(),
        operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "abc" },
        timestamp: 1,
      },
      {
        id: "delete:0",
        parentVersion: new Set(["root:0"]),
        operation: { type: OPERATION_TYPE.DELETE, index: 1, length: 1 },
        timestamp: 2,
      },
      {
        id: "left:0",
        parentVersion: new Set(["root:0"]),
        operation: { type: OPERATION_TYPE.INSERT, index: 3, text: "L" },
        timestamp: 3,
      },
      {
        id: "after-delete:0",
        parentVersion: new Set(["delete:0"]),
        operation: { type: OPERATION_TYPE.INSERT, index: 2, text: "D" },
        timestamp: 4,
      },
    ];

    const generated = new EgWalkerEngine().generate(events);

    expect(generated.stats.retreatCount).toBeGreaterThanOrEqual(2);
    expect(generated.stats.advanceCount).toBeGreaterThanOrEqual(1);
    expect(generated.text).toContain("D");
  });

  it("orders concurrent insertions through origin buckets", () => {
    const generated = new EgWalkerEngine().generate([
      {
        id: "root:0",
        parentVersion: new Set(),
        operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "X" },
        timestamp: 0,
      },
      {
        id: "z:0",
        parentVersion: new Set(["root:0"]),
        operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "Z" },
        timestamp: 1,
      },
      {
        id: "a:0",
        parentVersion: new Set(["root:0"]),
        operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "A" },
        timestamp: 2,
      },
    ]);

    expect(generated.text).toBe("ZAX");
  });

  it("orders version diffs deterministically for multi-event retreats and advances", () => {
    const graph = new EventGraph();
    for (const id of ["a", "b", "c"]) {
      graph.addEvent({
        id,
        parentVersion: new Set(),
        operation: { type: OPERATION_TYPE.INSERT, index: 0, text: id },
        timestamp: id.charCodeAt(0),
      });
    }

    const engine = new EgWalkerEngine();
    // @ts-expect-error - Exercise private ordering helper for coverage of multi-event diff sorting.
    engine.graph = graph;
    // @ts-expect-error - Exercise private ordering helper for coverage of multi-event diff sorting.
    engine.eventOrder.set("a", 0);
    // @ts-expect-error - Exercise private ordering helper for coverage of multi-event diff sorting.
    engine.eventOrder.set("b", 1);
    // @ts-expect-error - Exercise private ordering helper for coverage of multi-event diff sorting.
    engine.eventOrder.set("c", 2);

    // @ts-expect-error - Private method coverage for deterministic retreat/advance ordering.
    expect(engine.diffVersions(new Set(["b", "c"]), new Set(["a"]))).toEqual({
      retreat: ["c", "b"],
      advance: ["a"],
    });
    // @ts-expect-error - Private method coverage for deterministic retreat/advance ordering.
    expect(engine.diffVersions(new Set(["c"]), new Set(["a", "b"]))).toEqual({
      retreat: ["c"],
      advance: ["a", "b"],
    });
    // @ts-expect-error - Private method coverage for ID tie fallback.
    expect(engine.compareByTopologicalOrder("b", "a")).toBeGreaterThan(0);
    // @ts-expect-error - Private method coverage for locale-independent ID ordering.
    expect(engine.compareByTopologicalOrder("Z:0", "a:0")).toBeLessThan(0);
  });

  it("round-trips persisted event graph state through the public API", () => {
    const api = new EgWalkerReplica("alice", "Hello");
    api.insert(5, " world");
    api.delete(0, 1);

    const restored = EgWalkerReplica.deserialize(api.serialize(), "alice");
    restored.insert(10, "!");

    expect(restored.getText()).toBe("ello world!");
    expect(restored.exportEventGraph()).toHaveLength(3);
  });

  it("keeps public string indexes aligned with JS code units", () => {
    const api = new EgWalkerReplica("alice", "");

    api.insert(0, "😀");
    api.insert(api.getText().length, "!");

    expect(api.getText()).toBe("😀!");
  });
});

describe("EgWalker", () => {
  it("walks events through the engine and exposes final versions", () => {
    const walker = new EgWalker({ initialText: "Hi" });
    const result = walker.walk([
      {
        id: "alice:0",
        parentVersion: new Set(),
        operation: { type: OPERATION_TYPE.INSERT, index: 2, text: "!" },
        timestamp: 1,
      },
      {
        id: "alice:1",
        parentVersion: new Set(["alice:0"]),
        operation: { type: OPERATION_TYPE.DELETE, index: 0, length: 1 },
        timestamp: 2,
      },
    ]);

    expect(result.finalText).toBe("i!");
    expect(result.eventsProcessed).toBe(2);
    expect(walker.getPrepareVersion()).toEqual(new Set(["alice:1"]));
    expect(walker.getEffectVersion()).toEqual(new Set(["alice:1"]));
  });

  it("walks unordered complete event batches", () => {
    const walker = new EgWalker();
    const result = walker.walk([
      {
        id: "alice:1",
        parentVersion: new Set(["alice:0"]),
        operation: { type: OPERATION_TYPE.INSERT, index: 1, text: "B" },
        timestamp: 2,
      },
      {
        id: "alice:0",
        parentVersion: new Set(),
        operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "A" },
        timestamp: 1,
      },
    ]);

    expect(result.finalText).toBe("AB");
    expect(result.eventsProcessed).toBe(2);
    expect(walker.getPrepareVersion()).toEqual(new Set(["alice:1"]));
  });

  it("walks an empty event list without changing initial text", () => {
    const walker = new EgWalker({ initialText: "seed" });

    expect(walker.walk([])).toEqual({
      finalText: "seed",
      eventsProcessed: 0,
      retreatCount: 0,
      advanceCount: 0,
    });
    expect(walker.getPrepareVersion()).toEqual(new Set());
    expect(walker.getEffectVersion()).toEqual(new Set());
  });

  it("defaults walker initial text to an empty string", () => {
    const result = new EgWalker().walk([
      {
        id: "alice:0",
        parentVersion: new Set(),
        operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "A" },
        timestamp: 1,
      },
    ]);

    expect(result.finalText).toBe("A");
  });
});

describe("EventGraph version semantics", () => {
  it("expands frontier versions and diffs transitive event sets", () => {
    const graph = new EventGraph();
    const root: GraphEvent = {
      id: "root",
      parentVersion: new Set(),
      operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "A" },
      timestamp: 1,
    };
    const left: GraphEvent = {
      id: "left",
      parentVersion: new Set(["root"]),
      operation: { type: OPERATION_TYPE.INSERT, index: 1, text: "B" },
      timestamp: 2,
    };
    const right: GraphEvent = {
      id: "right",
      parentVersion: new Set(["root"]),
      operation: { type: OPERATION_TYPE.INSERT, index: 1, text: "C" },
      timestamp: 3,
    };

    graph.addEvent(root);
    graph.addEvent(left);
    graph.addEvent(right);

    expect(graph.getFrontier()).toEqual(new Set(["left", "right"]));
    expect(graph.expandVersion(new Set(["left"]))).toEqual(
      new Set(["root", "left"]),
    );
    expect(graph.diffVersions(new Set(["left"]), new Set(["right"]))).toEqual({
      onlyInLeft: new Set(["left"]),
      onlyInRight: new Set(["right"]),
    });
  });
});

describe("Full paper architecture utilities", () => {
  it("maps prepare/effect indexes through the ranked B-tree sequence", () => {
    const items = [
      { id: "a", prepare: 1, effect: 1 },
      { id: "b", prepare: 0, effect: 1 },
      { id: "c", prepare: 1, effect: 0 },
      { id: "d", prepare: 1, effect: 1 },
    ];
    const sequence = new IndexedSequence(
      (item: (typeof items)[number]) => item.prepare,
      (item: (typeof items)[number]) => item.effect,
      items,
    );

    expect(sequence.prepareIndexToPosition(0, false)).toBe(0);
    expect(sequence.prepareIndexToPosition(1, false)).toBe(2);
    expect(sequence.nextPrepareVisiblePosition(1)).toBe(2);
    expect(sequence.effectIndexBeforePosition(3)).toBe(2);

    items[1]!.prepare = 1;
    items[2]!.effect = 1;
    sequence.updateItem(items[1]!);
    sequence.updateItem(items[2]!);

    expect(sequence.prepareIndexToPosition(1, false)).toBe(1);
    expect(sequence.effectIndexBeforePosition(4)).toBe(4);
  });

  it("keeps ranked B-tree indexes correct across leaf and internal splits", () => {
    const items = Array.from({ length: 2_200 }, (_, index) => ({
      id: `item-${index}`,
      prepare: index % 3 === 0 ? 0 : 1,
      effect: index % 5 === 0 ? 0 : 1,
    }));
    const sequence = new IndexedSequence(
      (item: (typeof items)[number]) => item.prepare,
      (item: (typeof items)[number]) => item.effect,
    );

    for (const item of items) {
      sequence.push(item);
    }

    const expectedPreparePositions = items
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => item.prepare === 1)
      .map(({ index }) => index);
    const expectedEffectBefore1_700 = items
      .slice(0, 1_700)
      .filter((item) => item.effect === 1).length;

    expect(sequence.length).toBe(items.length);
    expect(sequence.at(1_799)).toBe(items[1_799]);
    expect(sequence.positionOf(items[1_799]!)).toBe(1_799);
    expect(sequence.prepareIndexToPosition(40, false)).toBe(
      expectedPreparePositions[40],
    );
    expect(sequence.effectIndexBeforePosition(1_700)).toBe(
      expectedEffectBefore1_700,
    );

    items[1_500]!.prepare = 1;
    items[1_500]!.effect = 1;
    sequence.updateItem(items[1_500]!);

    expect(sequence.nextPrepareVisiblePosition(1_499)).toBe(1_499);
    expect(sequence.positionOf(items[2_000]!)).toBe(2_000);
  });

  it("matches an array model across deterministic B-tree inserts and updates", () => {
    const random = createPrng(13_337);
    const model: SequenceModelItem[] = [];
    const sequence = new IndexedSequence<SequenceModelItem>(
      (item) => item.prepare,
      (item) => item.effect,
    );

    for (let step = 0; step < 1_000; step++) {
      const item: SequenceModelItem = {
        id: `item-${step}`,
        prepare: random() < 0.7 ? 1 : 0,
        effect: random() < 0.8 ? 1 : 0,
      };
      const index = Math.floor(random() * (model.length + 1));
      model.splice(index, 0, item);
      sequence.insert(index, item);

      if (step % 5 === 0 && model.length > 0) {
        const updateIndex = Math.floor(random() * model.length);
        const updated = model[updateIndex]!;
        updated.prepare = updated.prepare === 1 ? 0 : 1;
        updated.effect = updated.effect === 1 ? 0 : 1;
        sequence.updateItem(updated);
      }

      const probeIndex = Math.floor(random() * model.length);
      const probed = model[probeIndex]!;
      expect(sequence.at(probeIndex)).toBe(probed);
      expect(sequence.positionOf(probed)).toBe(probeIndex);

      const preparePositions = visiblePositions(model, "prepare");
      if (preparePositions.length > 0) {
        const prepareIndex = Math.floor(random() * preparePositions.length);
        expect(sequence.prepareIndexToPosition(prepareIndex, false)).toBe(
          preparePositions[prepareIndex],
        );
      }

      const effectProbe = Math.floor(random() * (model.length + 1));
      expect(sequence.effectIndexBeforePosition(effectProbe)).toBe(
        model.slice(0, effectProbe).filter((item) => item.effect === 1).length,
      );
    }

    expect(sequence.toArray()).toEqual(model);
  });

  it("covers ranked B-tree boundary behavior and bulk weight refresh", () => {
    const items = [
      { id: "a", prepare: 1, effect: 0 },
      { id: "b", prepare: 0, effect: 1 },
    ];
    const sequence = new IndexedSequence(
      (item: (typeof items)[number]) => item.prepare,
      (item: (typeof items)[number]) => item.effect,
      items,
    );

    expect(sequence.at(-1)).toBeUndefined();
    expect(sequence.at(2)).toBeUndefined();
    expect(sequence.slice(1)).toEqual([items[1]]);
    expect(sequence.indexOf((item) => item.id === "b")).toBe(1);
    expect(sequence.indexOf((item) => item.id === "missing")).toBe(-1);
    expect(sequence.positionOf({ id: "external", prepare: 1, effect: 1 })).toBe(
      -1,
    );
    expect(sequence.nextPrepareVisiblePosition(-1)).toBeNull();
    expect(sequence.nextPrepareVisiblePosition(3)).toBeNull();
    expect(sequence.prepareIndexToPosition(1, true)).toBe(2);
    expect(() => sequence.prepareIndexToPosition(-1, false)).toThrow(
      "Index -1 out of bounds",
    );
    expect(() => sequence.prepareIndexToPosition(1, false)).toThrow(
      "Index 1 out of bounds",
    );
    expect(() => sequence.insert(-1, items[0]!)).toThrow(
      "Insert index -1 out of bounds",
    );

    items[0]!.prepare = 0;
    items[0]!.effect = 1;
    items[1]!.prepare = 1;
    items[1]!.effect = 0;
    sequence.updateWeights();

    expect(sequence.prepareIndexToPosition(0, false)).toBe(1);
    expect(sequence.effectIndexBeforePosition(2)).toBe(1);

    sequence.clear();
    expect(sequence.length).toBe(0);
    expect(sequence.toArray()).toEqual([]);
    expect(sequence.indexOf(() => true)).toBe(-1);
    expect(sequence.effectIndexBeforePosition(10)).toBe(0);
    expect(sequence.prepareIndexToPosition(0, true)).toBe(0);
    expect(() => sequence.prepareIndexToPosition(0, false)).toThrow(
      "Index 0 out of bounds",
    );
    expect(() => sequence.insert(1, items[0]!)).toThrow(
      "Insert index 1 out of bounds",
    );
    expect(() => sequence.updateItem(items[0]!)).not.toThrow();
  });

  it("refreshes ranked B-tree weights across internal nodes", () => {
    const items = Array.from({ length: 140 }, (_, index) => ({
      id: `bulk-${index}`,
      prepare: 1,
      effect: 1,
    }));
    const sequence = new IndexedSequence(
      (item: (typeof items)[number]) => item.prepare,
      (item: (typeof items)[number]) => item.effect,
      items,
    );

    items.forEach((item, index) => {
      item.prepare = index === 139 ? 1 : 0;
      item.effect = index === 0 ? 1 : 0;
    });
    sequence.updateWeights();

    expect(sequence.prepareIndexToPosition(0, false)).toBe(139);
    expect(sequence.effectIndexBeforePosition(140)).toBe(1);
  });

  it("partially replays from a critical checkpoint using the full graph", () => {
    const graph = new EventGraph();
    const events: GraphEvent[] = [
      {
        id: "r:0",
        parentVersion: new Set(),
        operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "Hello" },
        timestamp: 1,
      },
      {
        id: "r:1",
        parentVersion: new Set(["r:0"]),
        operation: { type: OPERATION_TYPE.INSERT, index: 5, text: "!" },
        timestamp: 2,
      },
    ];
    events.forEach((event) => graph.addEvent(event));

    const result = new PartialReplayManager().replayFromCheckpoint(graph, {
      version: new Set(["r:0"]),
      text: "Hello",
    });

    expect(result.text).toBe("Hello!");
    expect(result.replayedEventIds).toEqual(["r:1"]);
  });

  it("detects linear frontier versions as critical checkpoints", () => {
    const graph = new EventGraph();
    graph.addEvent({
      id: "r:0",
      parentVersion: new Set(),
      operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "A" },
      timestamp: 1,
    });
    graph.addEvent({
      id: "r:1",
      parentVersion: new Set(["r:0"]),
      operation: { type: OPERATION_TYPE.INSERT, index: 1, text: "B" },
      timestamp: 2,
    });

    const analyzer = new CriticalVersionAnalyzer();

    expect(analyzer.isCritical(graph, new Set(["r:0"]))).toBe(true);
    expect(analyzer.latestCriticalVersion(graph)).toEqual(new Set(["r:1"]));
  });

  it("handles empty and non-critical versions in critical checkpoint analysis", () => {
    const graph = new EventGraph();
    const analyzer = new CriticalVersionAnalyzer();

    expect(analyzer.isCritical(graph, new Set())).toBe(true);
    expect(analyzer.latestCriticalVersion(graph)).toEqual(new Set());

    graph.addEvent({
      id: "left",
      parentVersion: new Set(),
      operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "L" },
      timestamp: 1,
    });
    graph.addEvent({
      id: "right",
      parentVersion: new Set(),
      operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "R" },
      timestamp: 2,
    });

    expect(analyzer.isCritical(graph, new Set(["left"]))).toBe(false);
  });

  it("rejects multi-frontier checkpoints with partially descended events", () => {
    const graph = new EventGraph();
    graph.addEvent({
      id: "a",
      parentVersion: new Set(),
      operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "A" },
      timestamp: 1,
    });
    graph.addEvent({
      id: "b",
      parentVersion: new Set(),
      operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "B" },
      timestamp: 2,
    });
    graph.addEvent({
      id: "c",
      parentVersion: new Set(["a"]),
      operation: { type: OPERATION_TYPE.INSERT, index: 1, text: "C" },
      timestamp: 3,
    });

    const analyzer = new CriticalVersionAnalyzer();

    expect(analyzer.isCritical(graph, new Set(["a", "b"]))).toBe(false);
  });

  it("round-trips the event graph through the columnar codec", () => {
    const graph = new EventGraph();
    graph.addEvent({
      id: "alice:0",
      parentVersion: new Set(),
      operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "Hi" },
      timestamp: 1,
    });
    graph.addEvent({
      id: "alice:1",
      parentVersion: new Set(["alice:0"]),
      operation: { type: OPERATION_TYPE.DELETE, index: 1, length: 1 },
      timestamp: 2,
    });

    const codec = new ColumnarEventGraphCodec();
    const decoded = codec.decode(codec.encode(graph));

    expect(decoded.getTopologicalOrder()).toEqual(graph.getTopologicalOrder());
    expect(decoded.getFrontier()).toEqual(new Set(["alice:1"]));
  });

  it("round-trips the event graph through the binary columnar codec", () => {
    const graph = new EventGraph();
    for (let i = 0; i < 20; i++) {
      graph.addEvent({
        id: `alice:${i}`,
        parentVersion: i === 0 ? new Set() : new Set([`alice:${i - 1}`]),
        operation: { type: OPERATION_TYPE.INSERT, index: i, text: "x" },
        timestamp: 1_778_000_000_000 + i,
      });
    }

    const codec = new ColumnarEventGraphCodec();
    const decoded = codec.decodeBinary(codec.encodeBinary(graph));

    expect(decoded.getTopologicalOrder()).toEqual(graph.getTopologicalOrder());
    expect(
      new EgWalkerEngine().generate(decoded.getTopologicalOrder()).text,
    ).toBe("x".repeat(20));
  });

  it("preserves a single sequence-zero generated ID through columnar codecs", () => {
    const graph = new EventGraph();
    graph.addEvent({
      id: "alice:0",
      parentVersion: new Set(),
      operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "A" },
      timestamp: 1,
    });

    const codec = new ColumnarEventGraphCodec();
    const decodedText = codec.decode(codec.encode(graph));
    const decodedBinary = codec.decodeBinary(codec.encodeBinary(graph));

    expect(decodedText.getTopologicalOrder().map((event) => event.id)).toEqual([
      "alice:0",
    ]);
    expect(
      decodedBinary.getTopologicalOrder().map((event) => event.id),
    ).toEqual(["alice:0"]);
  });

  it("decodes alternating columnar operation runs in linear run order", () => {
    const graph = new EventGraph();
    for (let i = 0; i < 800; i++) {
      graph.addEvent({
        id: `event:${i}`,
        parentVersion: i === 0 ? new Set() : new Set([`event:${i - 1}`]),
        operation:
          i % 2 === 0
            ? { type: OPERATION_TYPE.INSERT, index: 0, text: "x" }
            : { type: OPERATION_TYPE.DELETE, index: 0, length: 1 },
        timestamp: i,
      });
    }

    const codec = new ColumnarEventGraphCodec();
    const encoded = codec.encode(graph);
    const decoded = codec.decode(encoded);

    expect(encoded.operationRuns).toHaveLength(800);
    expect(decoded.getTopologicalOrder()).toEqual(graph.getTopologicalOrder());
  });

  it("rejects malformed binary columnar payloads", () => {
    const codec = new ColumnarEventGraphCodec();

    expect(() => codec.decodeBinary(new Uint8Array())).toThrow(
      "Unexpected end of varint",
    );
    expect(() => codec.decodeBinary(new Uint8Array([1, 0]))).toThrow(
      "Invalid eg-walker columnar graph header",
    );
    expect(() => codec.decodeBinary(new Uint8Array([4, 0x45, 0x47]))).toThrow(
      "Unexpected end of binary eg-walker graph",
    );
  });

  it("covers columnar ID and malformed operation run edge cases", () => {
    const graph = new EventGraph();
    graph.addEvent({
      id: "custom-id",
      parentVersion: new Set(),
      operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "A" },
      timestamp: 1,
    });
    graph.addEvent({
      id: "replica:not-number",
      parentVersion: new Set(["custom-id"]),
      operation: { type: OPERATION_TYPE.INSERT, index: 1, text: "B" },
      timestamp: 2,
    });

    const codec = new ColumnarEventGraphCodec();
    const encoded = codec.encode(graph);

    expect(codec.toSerializedGraph(encoded).events).toHaveLength(2);
    expect(
      codec.decodeBinary(codec.encodeBinary(graph)).getAllEvents(),
    ).toHaveLength(2);
    expect(() =>
      codec.decode({
        ...encoded,
        operationRuns: [],
      }),
    ).toThrow("Missing operation run for event offset 0");
    expect(() =>
      codec.decode({
        ...encoded,
        operationRuns: [
          {
            type: OPERATION_TYPE.INSERT,
            startIndex: 0,
            startEventOffset: 1,
            length: 1,
            textLength: 1,
          },
        ],
      }),
    ).toThrow("Operation run 0 does not cover event offset 0");

    expect(() =>
      codec.decode({
        ...encoded,
        parentOverrides: [{ eventOffset: 1, parents: ["missing"] }],
      }),
    ).toThrow("Missing parent event: missing");

    graph.addEvent({
      id: "replica:2",
      parentVersion: new Set(["replica:not-number"]),
      operation: { type: OPERATION_TYPE.INSERT, index: 2, text: "C" },
      timestamp: -1,
    });
    expect(() => codec.encodeBinary(graph)).toThrow(
      "Cannot encode invalid varint value -1",
    );
  });

  it("round-trips a large inserted-content payload through the binary codec", () => {
    // Build distinct, mostly-incompressible blocks so LZ4 cannot dedupe across
    // events. Exercises the BinaryWriter buffer growth that previously
    // overflowed JS arg limits via push-spread of a Uint8Array.
    let prng = 0x9e_37_79_b9 >>> 0;
    const nextChar = (): string => {
      prng = (prng * 1_103_515_245 + 12_345) >>> 0;
      return String.fromCharCode(0x21 + (prng % 94));
    };
    const blocks = Array.from({ length: 32 }, () =>
      Array.from({ length: 4_096 }, nextChar).join(""),
    );

    const graph = new EventGraph();
    let cursor = 0;
    blocks.forEach((block, i) => {
      graph.addEvent({
        id: `bulk:${i}`,
        parentVersion: i === 0 ? new Set() : new Set([`bulk:${i - 1}`]),
        operation: { type: OPERATION_TYPE.INSERT, index: cursor, text: block },
        timestamp: 1_778_000_000_000 + i,
      });
      cursor += block.length;
    });

    const codec = new ColumnarEventGraphCodec();
    const encoded = codec.encodeBinary(graph);
    const decoded = codec.decodeBinary(encoded);
    const text = new EgWalkerEngine().generate(
      decoded.getTopologicalOrder(),
    ).text;
    expect(text).toBe(blocks.join(""));
  });

  it("caps lz4 destination allocation against the declared textLengths sum", () => {
    const graph = new EventGraph();
    graph.addEvent({
      id: "bounded:0",
      parentVersion: new Set(),
      operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "😀" },
      timestamp: 1,
    });

    const codec = new ColumnarEventGraphCodec();
    const encoded = codec.encodeBinary(graph);
    const decompressSpy = vi.spyOn(lz4, "decompress");

    try {
      codec.decodeBinary(encoded);
      // 2 UTF-16 code units * 4 + 64 = 72 bytes maxInsertedBytes.
      expect(decompressSpy).toHaveBeenCalledWith(expect.any(Uint8Array), 72);
    } finally {
      decompressSpy.mockRestore();
    }
  });

  it("rejects payloads whose decompressed content does not match declared textLengths", () => {
    const codec = new ColumnarEventGraphCodec();
    // Real, well-formed payload: one 5-char insert. textLengths sum = 5.
    const realGraph = new EventGraph();
    realGraph.addEvent({
      id: "real:0",
      parentVersion: new Set(),
      operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "hello" },
      timestamp: 1,
    });
    const realPayload = codec.encodeBinary(realGraph);

    // Tampered payload: a 1-char insert (textLengths sum = 1) but the LZ4
    // frame still carries the 5-byte original content. After decompression,
    // insertedContent.length would be 5 even though textLengths declares 1.
    // This is what a decompression-bomb / content-injection payload would
    // produce, and we want the codec to reject it.
    const tamperedGraph = new EventGraph();
    tamperedGraph.addEvent({
      id: "real:0",
      parentVersion: new Set(),
      operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "x" },
      timestamp: 1,
    });
    const tampered = codec.encodeBinary(tamperedGraph);

    // Splice the real payload's LZ4 frame into the tampered payload by
    // mocking lz4.decompress to return the larger content while textLengths
    // remains 1. lz4js silently truncates to maxInsertedBytes; the codec's
    // length-equality check is what catches the tampering.
    const decompressSpy = vi
      .spyOn(lz4, "decompress")
      .mockReturnValue(new TextEncoder().encode("hello"));

    try {
      expect(() => codec.decodeBinary(tampered)).toThrow(
        /Decompressed inserted-content size mismatch/,
      );
    } finally {
      decompressSpy.mockRestore();
    }
    // Sanity-check the real payload still round-trips with the spy
    // restored — confirms the tampering was the only thing the test
    // depended on.
    expect(codec.decodeBinary(realPayload).getAllEvents()).toHaveLength(1);
  });

  it("rejects binary payloads whose magic prefix is too short", () => {
    const codec = new ColumnarEventGraphCodec();
    // Length-prefix says 3 bytes of magic, but EGW2 is 4 bytes. Even though
    // the bytes that ARE present match, the length must equal the magic.
    expect(() =>
      codec.decodeBinary(new Uint8Array([3, 0x45, 0x47, 0x57])),
    ).toThrow("Invalid eg-walker columnar graph header");
  });

  it("rejects binary payloads from older incompatible versions (EGW1)", () => {
    const codec = new ColumnarEventGraphCodec();
    // 4-byte EGW1 prefix; current decoder expects EGW2.
    const egw1Header = new Uint8Array([4, 0x45, 0x47, 0x57, 0x31]);
    expect(() => codec.decodeBinary(egw1Header)).toThrow(
      "Invalid eg-walker columnar graph header",
    );
  });

  it("survives deep histories without recursion-stack overflow", () => {
    const graph = new EventGraph();
    const total = 25_000;
    for (let i = 0; i < total; i++) {
      graph.addEvent({
        id: `deep:${i}`,
        parentVersion: i === 0 ? new Set() : new Set([`deep:${i - 1}`]),
        operation: { type: OPERATION_TYPE.INSERT, index: i, text: "a" },
        timestamp: i,
      });
    }

    const ordered = graph.getTopologicalOrder();
    expect(ordered).toHaveLength(total);
    expect(graph.expandVersion(graph.getFrontier()).size).toBe(total);

    const reSerialized = EventGraph.deserialize(graph.serialize());
    expect(reSerialized.getAllEvents()).toHaveLength(total);
  });
});

describe("EgWalkerEngine transformed deletes", () => {
  it("emits non-contiguous delete operations when concurrent inserts split the run", () => {
    // Topological tie-breaking sorts by event id. Choose ids so the insert is
    // applied before the concurrent delete, leaving X effect-visible while
    // the delete walks per-character. The transformed delete op output then
    // contains a gap at X's effect position.
    const events: GraphEvent[] = [
      {
        id: "root:0",
        parentVersion: new Set(),
        operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "abcd" },
        timestamp: 1,
      },
      {
        id: "a-ins:0",
        parentVersion: new Set(["root:0"]),
        operation: { type: OPERATION_TYPE.INSERT, index: 2, text: "X" },
        timestamp: 2,
      },
      {
        id: "z-del:0",
        parentVersion: new Set(["root:0"]),
        operation: { type: OPERATION_TYPE.DELETE, index: 0, length: 4 },
        timestamp: 3,
      },
    ];

    const generated = new EgWalkerEngine().generate(events);

    expect(generated.text).toBe("X");
    const deletes = generated.transformedOperations.filter(
      (op) => op.type === OPERATION_TYPE.DELETE,
    );
    expect(deletes.length).toBeGreaterThanOrEqual(2);
    const totalDeleted = deletes.reduce(
      (sum, op) => sum + (op.type === OPERATION_TYPE.DELETE ? op.length : 0),
      0,
    );
    expect(totalDeleted).toBe(4);
  });
});
