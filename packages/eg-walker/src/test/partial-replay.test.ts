import { describe, expect, it } from "vitest";
import { OPERATION_TYPE } from "../constants/operation-types";
import { CriticalVersionAnalyzer } from "../engine/critical-version";
import { EgWalkerEngine } from "../engine/eg-walker-engine";
import {
  PartialReplayManager,
  type ReplayCheckpoint,
} from "../engine/partial-replay";
import { EventGraph } from "../graph/event-graph";
import { PersistentUtf16Rope } from "../text/persistent-utf16-rope";
import type { GraphEvent } from "../types";

describe("PartialReplayManager", () => {
  it("should reject checkpoints without document content", () => {
    // Arrange
    const manager = new PartialReplayManager();
    const graph = new EventGraph();
    const missingContent = {
      version: new Set(),
    } as unknown as ReplayCheckpoint;

    // Act
    const replay = () => manager.replayFromCheckpoint(graph, missingContent);

    // Assert
    expect(replay).toThrow(/requires text or textBuffer content/);
    expect(
      manager.replayFromCheckpoint(graph, {
        version: new Set(),
        text: "",
      }).text,
    ).toBe("");
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

  it("splits a placeholder for an insert landing inside checkpoint-era text", () => {
    // Section 3.6: pre-checkpoint content is one placeholder record. An insert
    // at index 5 must split it into ["Hello"] + new chars + [" world"] without
    // materializing one CRDT item per pre-checkpoint code unit.
    const graph = new EventGraph();
    graph.addEvent({
      id: "r:0",
      parentVersion: new Set(),
      operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "Hello world" },
      timestamp: 1,
    });
    graph.addEvent({
      id: "r:1",
      parentVersion: new Set(["r:0"]),
      operation: { type: OPERATION_TYPE.INSERT, index: 5, text: "!!" },
      timestamp: 2,
    });

    const result = new PartialReplayManager().replayFromCheckpoint(graph, {
      version: new Set(["r:0"]),
      text: "Hello world",
    });

    expect(result.text).toBe("Hello!! world");
    expect(result.replayedEventIds).toEqual(["r:1"]);
  });

  it("splits a placeholder for a delete touching checkpoint-era text", () => {
    // Single-char delete inside the placeholder must split off exactly one
    // character so prepare/effect indexing for the remaining region stays
    // accurate.
    const graph = new EventGraph();
    graph.addEvent({
      id: "r:0",
      parentVersion: new Set(),
      operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "abcdef" },
      timestamp: 1,
    });
    graph.addEvent({
      id: "r:1",
      parentVersion: new Set(["r:0"]),
      operation: { type: OPERATION_TYPE.DELETE, index: 2, length: 1 },
      timestamp: 2,
    });

    const result = new PartialReplayManager().replayFromCheckpoint(graph, {
      version: new Set(["r:0"]),
      text: "abcdef",
    });

    expect(result.text).toBe("abdef");
    expect(result.replayedEventIds).toEqual(["r:1"]);
  });

  it("handles a multi-char delete inside a placeholder in one batch split", () => {
    // The delete spans 3 code units of the placeholder. The engine should split
    // the placeholder into [prefix, deleted-segment, suffix] in one shot rather
    // than per-character, while still emitting a single transformed delete run.
    const graph = new EventGraph();
    graph.addEvent({
      id: "r:0",
      parentVersion: new Set(),
      operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "abcdefghij" },
      timestamp: 1,
    });
    graph.addEvent({
      id: "r:1",
      parentVersion: new Set(["r:0"]),
      operation: { type: OPERATION_TYPE.DELETE, index: 3, length: 4 },
      timestamp: 2,
    });

    const result = new PartialReplayManager().replayFromCheckpoint(graph, {
      version: new Set(["r:0"]),
      text: "abcdefghij",
    });

    expect(result.text).toBe("abchij");
    expect(result.transformedOperations).toEqual([
      { type: OPERATION_TYPE.DELETE, index: 3, length: 4 },
    ]);
  });

  it("supports interleaved inserts and deletes against placeholder text", () => {
    // Mixed workload: insert then delete inside the placeholder region. The
    // partial replay result must match what a full replay from scratch
    // produces, proving that splitting placeholders preserves convergence.
    const graph = new EventGraph();
    const events: GraphEvent[] = [
      {
        id: "r:0",
        parentVersion: new Set(),
        operation: {
          type: OPERATION_TYPE.INSERT,
          index: 0,
          text: "The quick brown fox",
        },
        timestamp: 1,
      },
      {
        id: "r:1",
        parentVersion: new Set(["r:0"]),
        operation: { type: OPERATION_TYPE.INSERT, index: 10, text: "very " },
        timestamp: 2,
      },
      {
        id: "r:2",
        parentVersion: new Set(["r:1"]),
        operation: { type: OPERATION_TYPE.DELETE, index: 4, length: 6 },
        timestamp: 3,
      },
    ];
    events.forEach((event) => graph.addEvent(event));

    const partial = new PartialReplayManager().replayFromCheckpoint(graph, {
      version: new Set(["r:0"]),
      text: "The quick brown fox",
    });
    const full = new EgWalkerEngine().generate(graph.getTopologicalOrder());

    expect(partial.text).toBe(full.text);
  });

  it("converges with full replay for overlapping concurrent deletes inside placeholder text", () => {
    // Regression: two concurrent multi-character deletes targeting the same
    // checkpoint-era region used to mangle the document because the
    // placeholder branch removed text again after a sibling delete had
    // already retired the same segment. Partial replay must match full
    // replay for both exact and partial overlaps.
    const buildGraph = (
      e2: GraphEvent["operation"],
    ): { graph: EventGraph; events: GraphEvent[] } => {
      const graph = new EventGraph();
      const events: GraphEvent[] = [
        {
          id: "r:0",
          parentVersion: new Set(),
          operation: {
            type: OPERATION_TYPE.INSERT,
            index: 0,
            text: "abcdef",
          },
          timestamp: 1,
        },
        {
          id: "alice:0",
          parentVersion: new Set(["r:0"]),
          operation: { type: OPERATION_TYPE.DELETE, index: 2, length: 2 },
          timestamp: 2,
        },
        {
          id: "bob:0",
          parentVersion: new Set(["r:0"]),
          operation: e2,
          timestamp: 3,
        },
      ];
      events.forEach((event) => graph.addEvent(event));
      return { graph, events };
    };

    const exact = buildGraph({
      type: OPERATION_TYPE.DELETE,
      index: 2,
      length: 2,
    });
    const partial = buildGraph({
      type: OPERATION_TYPE.DELETE,
      index: 1,
      length: 4,
    });

    for (const { graph } of [exact, partial]) {
      const fullText = new EgWalkerEngine().generate(
        graph.getTopologicalOrder(),
      ).text;
      const partialText = new PartialReplayManager().replayFromCheckpoint(
        graph,
        { version: new Set(["r:0"]), text: "abcdef" },
      ).text;
      expect(partialText).toBe(fullText);
    }
  });

  it("converges with full replay when concurrent inserts split the same placeholder at different offsets", () => {
    // Regression for partial-replay placeholder splitting: when
    // partial replay starts from a checkpoint, pre-checkpoint text is
    // collapsed into a single placeholder record. Two concurrent
    // inserts inside that placeholder split it at different offsets,
    // and a descendant of one of those inserts is later integrated
    // into the conflict region created by the other. The YATA
    // integration scan compares origin ids by identity, so the engine
    // has to rewrite the existing items' `originLeft` references when
    // a placeholder splits — otherwise siblings anchored to the same
    // logical boundary look as if they have different origins and
    // partial replay diverges from full replay.
    const graph = new EventGraph();
    const events: GraphEvent[] = [
      {
        id: "root:0",
        parentVersion: new Set(),
        operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "abcdef" },
        timestamp: 1,
      },
      {
        id: "b:0",
        parentVersion: new Set(["root:0"]),
        operation: { type: OPERATION_TYPE.INSERT, index: 2, text: "B" },
        timestamp: 2,
      },
      {
        id: "c:0",
        parentVersion: new Set(["root:0"]),
        operation: { type: OPERATION_TYPE.INSERT, index: 1, text: "C" },
        timestamp: 3,
      },
      {
        id: "f:0",
        parentVersion: new Set(["c:0"]),
        operation: { type: OPERATION_TYPE.INSERT, index: 3, text: "F" },
        timestamp: 4,
      },
    ];
    events.forEach((event) => graph.addEvent(event));

    const fullText = new EgWalkerEngine().generate(
      graph.getTopologicalOrder(),
    ).text;
    const partialText = new PartialReplayManager().replayFromCheckpoint(graph, {
      version: new Set(["root:0"]),
      text: "abcdef",
    }).text;

    expect(partialText).toBe(fullText);
    expect(partialText).toBe("aCbBFcdef");
  });

  it("does not materialize per-character CRDT items for the checkpoint text", () => {
    // Acceptance criterion for issue #665: partial replay must avoid the
    // O(checkpoint.length) item cost. We use a long pre-checkpoint string and
    // a single trailing insert. The engine reports `eventsProcessed` covering
    // only the divergent suffix; the placeholder representation is what makes
    // this realistic for large documents.
    const checkpointText = "x".repeat(5000);
    const graph = new EventGraph();
    graph.addEvent({
      id: "r:0",
      parentVersion: new Set(),
      operation: {
        type: OPERATION_TYPE.INSERT,
        index: 0,
        text: checkpointText,
      },
      timestamp: 1,
    });
    graph.addEvent({
      id: "r:1",
      parentVersion: new Set(["r:0"]),
      operation: { type: OPERATION_TYPE.INSERT, index: 2500, text: "!" },
      timestamp: 2,
    });

    const result = new PartialReplayManager().replayFromCheckpoint(graph, {
      version: new Set(["r:0"]),
      text: checkpointText,
    });

    expect(result.text).toBe(`${"x".repeat(2500)}!${"x".repeat(2500)}`);
    expect(result.stats.eventsProcessed).toBe(1);
  });

  it("should replay a small suffix without flattening the checkpoint rope", () => {
    // Arrange
    const insertionIndex = 1024 * 1024;
    const checkpointText = "x".repeat(insertionIndex * 2);
    const checkpointBuffer = PersistentUtf16Rope.from(checkpointText);
    const events: GraphEvent[] = [
      {
        id: "root:0",
        parentVersion: new Set(),
        operation: {
          type: OPERATION_TYPE.INSERT,
          index: 0,
          text: checkpointText,
        },
        timestamp: 1,
      },
      {
        id: "suffix:0",
        parentVersion: new Set(["root:0"]),
        operation: {
          type: OPERATION_TYPE.INSERT,
          index: insertionIndex,
          text: "!",
        },
        timestamp: 2,
      },
    ];
    const graph = EventGraph.fromEvents(events);
    PersistentUtf16Rope.resetInstrumentation();

    // Act
    const result = new PartialReplayManager().replayFromCheckpoint(graph, {
      version: new Set(["root:0"]),
      textBuffer: checkpointBuffer,
    });

    // Assert
    expect(result.textBuffer.length).toBe(checkpointText.length + 1);
    expect(
      result.textBuffer.slice(insertionIndex - 1, insertionIndex + 2),
    ).toBe("x!x");
    expect(result.stats.eventsProcessed).toBe(1);
    expect(result.stats.sequenceRecordCount).toBe(3);
    expect(PersistentUtf16Rope.getInstrumentation()).toMatchObject({
      flattenCount: 0,
      flattenedCodeUnits: 0,
    });
  });
});

describe("CriticalVersionAnalyzer", () => {
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
});
