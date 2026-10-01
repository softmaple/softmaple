/**
 * Insert-run records: a multi-character INSERT is one CRDT record that
 * splits only where a later insert or delete lands.
 *
 * Issue: softmaple/softmaple#953 ("store multi-character inserts as a single
 * run record").
 */

import { describe, expect, it } from "vitest";

import { createSequenceAnchorProjection } from "../anchors";
import { OPERATION_TYPE } from "../constants/operation-types";
import { EgWalkerReplica } from "../core/replica";
import {
  EgWalkerEngine,
  type EngineSnapshotState,
} from "../engine/eg-walker-engine";
import { planPackedCriticalReplaySections } from "../engine/packed-critical-replay-plan";
import type { EngineSequenceRecord } from "../engine/sequence-records";
import { ColumnarEventGraphCodec } from "../graph/columnar-codec";
import { EventGraph } from "../graph/event-graph";
import { PersistentUtf16Rope } from "../text/persistent-utf16-rope";
import type { EventId, GraphEvent } from "../types";

describe("EgWalkerEngine insert-run records", () => {
  it("should integrate a multi-character insert as one record", () => {
    // Arrange
    const events = [insertEvent("alice:0", [], 0, "hello world")];

    // Act
    const { engine, generated } = replay(events);

    // Assert
    expect(generated.text).toBe("hello world");
    expect(generated.stats.sequenceRecordCount).toBe(1);
    expect(engine.getSequenceRecords()).toEqual([
      {
        id: "alice:0:0",
        eventId: "alice:0",
        content: "hello world",
        originLeft: null,
        originRight: null,
        everDeleted: false,
        prepareState: 1,
        run: null,
      },
    ]);
  });

  it("should split an insert run only where later inserts land", () => {
    // Arrange
    const events = [
      insertEvent("alice:0", [], 0, "abcdefgh"),
      insertEvent("bob:0", ["alice:0"], 6, "X"),
      insertEvent("bob:1", ["bob:0"], 8, "Y"),
    ];

    // Act
    const { engine, generated } = replay(events);

    // Assert
    expect(generated.text).toBe("abcdefXgYh");
    expect(generated.stats.sequenceRecordCount).toBe(5);
    expect(engine.getSequenceRecords().map(identityOf)).toEqual([
      { id: "alice:0:0", content: "abcdef", originLeft: null },
      { id: "bob:0:0", content: "X", originLeft: "alice:0:0" },
      { id: "alice:0:6", content: "g", originLeft: "alice:0:0" },
      { id: "bob:1:0", content: "Y", originLeft: "alice:0:6" },
      { id: "alice:0:7", content: "h", originLeft: "alice:0:6" },
    ]);
  });

  it("should isolate a deleted range of an insert run as its own record", () => {
    // Arrange
    const events = [
      insertEvent("alice:0", [], 0, "abcdef"),
      deleteEvent("alice:1", ["alice:0"], 2, 2),
    ];

    // Act
    const { engine, generated } = replay(events);

    // Assert
    expect(generated.text).toBe("abef");
    expect(
      engine
        .getSequenceRecords()
        .map(({ id, content, everDeleted }) => ({ id, content, everDeleted })),
    ).toEqual([
      { id: "alice:0:0", content: "ab", everDeleted: false },
      { id: "alice:0:2", content: "cd", everDeleted: true },
      { id: "alice:0:4", content: "ef", everDeleted: false },
    ]);
    expect(engine.getDeleteTargetRecords()).toEqual([
      { deleteEventId: "alice:1", targetIds: ["alice:0:2"] },
    ]);
  });

  it("should retreat and advance every fragment of a split insert run", () => {
    // Arrange
    const events = [
      insertEvent("alice:0", [], 0, "abcdef"),
      deleteEvent("alice:1", ["alice:0"], 2, 2),
      insertEvent("bob:0", [], 0, "X"),
    ];
    const { engine, graph, generated } = replay(events);

    // Act
    const prepareTexts = [[], ["alice:0"], ["alice:1"], ["bob:0"]].map(
      (version) => {
        engine.transitionPrepareView(new Set(version), graph);
        return engine.getPrepareSlice(0, engine.getPrepareLength());
      },
    );

    // Assert
    expect(generated.text).toBe("abefX");
    expect(prepareTexts).toEqual(["", "abcdef", "abef", "X"]);
  });

  it("should keep splitting insert runs restored from sequence records", () => {
    // Arrange
    const history = [
      insertEvent("alice:0", [], 0, "hello world"),
      insertEvent("bob:0", ["alice:0"], 5, ","),
    ];
    const suffix = [
      deleteEvent("carol:0", ["alice:0"], 6, 5),
      insertEvent("dave:0", [], 0, "!"),
    ];
    const graph = EventGraph.fromEvents([...history, ...suffix]);
    const source = new EgWalkerEngine();
    source.generate(history, "", { eventGraph: graph, eventOrder: history });
    const restored = EgWalkerEngine.fromSnapshotState(
      snapshotStateOf(source, graph),
    );

    // Act
    for (const event of suffix) {
      restored.applyEvent(event, graph);
    }

    // Assert
    expect(restored.getText()).toBe(
      replay([...history, ...suffix]).generated.text,
    );
    restored.transitionPrepareView(new Set(), graph);
    expect(restored.getPrepareLength()).toBe(0);
  });

  it("should keep merging per-code-unit records of an earlier snapshot", () => {
    // Arrange
    const concurrent = insertEvent("bob:0", [], 0, "X");
    const graph = EventGraph.fromEvents([
      insertEvent("alice:0", [], 0, "abc"),
      concurrent,
    ]);
    const restored = EgWalkerEngine.fromSnapshotState({
      graph,
      currentVersion: new Set(["alice:0"]),
      text: "abc",
      sequenceRecords: perCodeUnitRecords("alice:0", "abc"),
    });

    // Act
    restored.applyEvent(concurrent, graph);

    // Assert
    expect(restored.getText()).toBe("abcX");
    restored.transitionPrepareView(new Set(), graph);
    expect(restored.getPrepareLength()).toBe(0);
  });

  it("should replay scalar deletes inside an insert run from packed columns", () => {
    // Arrange
    const events = [
      insertEvent("other:0", [], 0, "X"),
      insertEvent("paste:0", [], 0, "abcdef"),
      deleteEvent("paste:1", ["paste:0"], 1, 1),
      deleteEvent("paste:2", ["paste:1"], 1, 1),
      deleteEvent("paste:3", ["paste:2"], 1, 1),
    ];
    const graph = pack(events);
    const plan = planPackedCriticalReplaySections(graph)!;
    const packedEngine = new EgWalkerEngine();

    // Act
    const packed = packedEngine.generatePackedSectionRange(
      plan,
      0,
      plan.sectionCount,
      graph,
      new Set(),
      PersistentUtf16Rope.from(""),
    );

    // Assert
    expect(packed.text).toBe("Xaef");
    expect(
      packedEngine
        .getSequenceRecords()
        .map(({ id, content, everDeleted }) => ({ id, content, everDeleted })),
    ).toEqual([
      { id: "other:0:0", content: "X", everDeleted: false },
      { id: "paste:0:0", content: "a", everDeleted: false },
      { id: "paste:0:1", content: "b", everDeleted: true },
      { id: "paste:0:2", content: "c", everDeleted: true },
      { id: "paste:0:3", content: "d", everDeleted: true },
      { id: "paste:0:4", content: "ef", everDeleted: false },
    ]);
  });

  it("should name every atom of a split paste by its offset in the paste", () => {
    // Arrange
    const alice = new EgWalkerReplica("alice");
    alice.insert(0, "abcdefgh");
    const bob = EgWalkerReplica.fromEventGraph("bob", alice.exportEventGraph());
    bob.insert(6, "X");
    bob.insert(8, "Y");

    // Act
    const projection = createSequenceAnchorProjection(bob);

    // Assert
    expect(projection.text).toBe("abcdefXgYh");
    expect(projection.captureAnchor(9, "before")).toEqual({
      type: "atom",
      eventId: "alice:0",
      offset: 7,
      affinity: "before",
    });
  });
});

describe("EgWalkerReplica concurrent paste merge", () => {
  it("should merge a 100,000-character paste and a concurrent keystroke in at most ten records", () => {
    // Arrange
    const base = "The quick brown fox jumps over the lazy dog.";
    const paste = "lorem ipsum ".repeat(10_000).slice(0, 100_000);
    const paster = new EgWalkerReplica("paste-author", base);
    const editor = new EgWalkerReplica("remote-editor", base);
    const pasteEvent = paster.insert(20, paste)!;
    const keystroke = editor.insert(4, "x")!;

    // Act
    paster.applyRemoteEvent(keystroke);
    editor.applyRemoteEvent(pasteEvent);

    // Assert
    const expected = `${base.slice(0, 4)}x${base.slice(4, 20)}${paste}${base.slice(20)}`;
    for (const replica of [paster, editor]) {
      const stats = replica.getReplayStats();
      expect(replica.getText()).toBe(expected);
      expect(stats.sequenceRecordCount).toBeLessThanOrEqual(10);
      expect(stats.peakSequenceRecordCount).toBeLessThanOrEqual(10);
    }
  });
});

// Helpers

const insertEvent = (
  id: EventId,
  parents: ReadonlyArray<EventId>,
  index: number,
  text: string,
): GraphEvent => ({
  id,
  operation: { type: OPERATION_TYPE.INSERT, index, text },
  parentVersion: new Set(parents),
  timestamp: 0,
});

const deleteEvent = (
  id: EventId,
  parents: ReadonlyArray<EventId>,
  index: number,
  length: number,
): GraphEvent => ({
  id,
  operation: { type: OPERATION_TYPE.DELETE, index, length },
  parentVersion: new Set(parents),
  timestamp: 0,
});

/** Replay `events` in the given order through a fresh engine. */
const replay = (events: ReadonlyArray<GraphEvent>) => {
  const graph = EventGraph.fromEvents(events);
  const engine = new EgWalkerEngine();
  const generated = engine.generate(events, "", {
    eventGraph: graph,
    eventOrder: events,
  });
  return { engine, graph, generated };
};

const pack = (events: ReadonlyArray<GraphEvent>): EventGraph => {
  const codec = new ColumnarEventGraphCodec();
  return codec.decodeBinary(codec.encodeBinary(EventGraph.fromEvents(events)));
};

const identityOf = ({ id, content, originLeft }: EngineSequenceRecord) => ({
  id,
  content,
  originLeft,
});

const snapshotStateOf = (
  engine: EgWalkerEngine,
  graph: EventGraph,
): EngineSnapshotState => ({
  graph,
  currentVersion: engine.getCurrentVersion(),
  text: engine.getText(),
  sequenceRecords: engine.getSequenceRecords(),
  deleteTargets: engine.getDeleteTargetRecords(),
});

/** The records an engine wrote for an insert before insert runs existed. */
const perCodeUnitRecords = (
  eventId: EventId,
  text: string,
): EngineSequenceRecord[] =>
  Array.from(text, (codeUnit, offset) => ({
    id: `${eventId}:${offset}`,
    eventId,
    content: codeUnit,
    originLeft: offset === 0 ? null : `${eventId}:${offset - 1}`,
    originRight: null,
    everDeleted: false,
    prepareState: 1,
    run: null,
  }));
