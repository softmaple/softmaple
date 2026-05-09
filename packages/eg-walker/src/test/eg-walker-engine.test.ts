import { describe, expect, it } from "vitest";
import { OPERATION_TYPE } from "../constants/operation-types";
import { CriticalVersionAnalyzer } from "../engine/critical-version";
import { EgWalkerAPI } from "../core/external-api";
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

  it("round-trips persisted event graph state through the public API", () => {
    const api = new EgWalkerAPI("alice", "Hello");
    api.insert(5, " world");
    api.delete(0, 1);

    const restored = EgWalkerAPI.deserialize(api.serialize(), "alice");
    restored.insert(10, "!");

    expect(restored.getText()).toBe("ello world!");
    expect(restored.exportEventGraph()).toHaveLength(3);
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
});
