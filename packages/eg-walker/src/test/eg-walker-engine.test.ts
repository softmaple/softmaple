import { describe, expect, it } from "vitest";
import { OPERATION_TYPE } from "../constants/operation-types";
import { EgWalkerReplica } from "../core/replica";
import { EgWalkerEngine } from "../engine/eg-walker-engine";
import { EventGraph } from "../graph/event-graph";
import { PersistentUtf16Rope } from "../text/persistent-utf16-rope";
import type { EventId, GraphEvent } from "../types";

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

  it("can replay without retaining transformed operations", () => {
    const events: GraphEvent[] = [
      {
        id: "alice:0",
        parentVersion: new Set(),
        operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "A" },
        timestamp: 1,
      },
      {
        id: "alice:1",
        parentVersion: new Set(["alice:0"]),
        operation: { type: OPERATION_TYPE.INSERT, index: 1, text: "B" },
        timestamp: 2,
      },
    ];

    const generated = new EgWalkerEngine().generate(events, "", {
      collectTransformedOperations: false,
    });

    expect(generated.text).toBe("AB");
    expect(generated.transformedOperations).toEqual([]);
    expect(generated.stats.eventsProcessed).toBe(events.length);
  });

  it("materializes cold-replay text once and remains incrementally usable", () => {
    const events: GraphEvent[] = [
      {
        id: "alice:0",
        parentVersion: new Set(),
        operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "ab" },
        timestamp: 1,
      },
      {
        id: "alice:1",
        parentVersion: new Set(["alice:0"]),
        operation: { type: OPERATION_TYPE.INSERT, index: 2, text: "X" },
        timestamp: 2,
      },
      {
        id: "bob:0",
        parentVersion: new Set(["alice:0"]),
        operation: { type: OPERATION_TYPE.DELETE, index: 0, length: 1 },
        timestamp: 3,
      },
    ];
    const graph = EventGraph.fromEvents(events);
    const eagerEngine = new EgWalkerEngine();
    const eager = eagerEngine.generate(events, "", {
      eventGraph: graph,
      eventOrder: events,
    });

    PersistentUtf16Rope.resetInstrumentation();
    const coldEngine = new EgWalkerEngine();
    const cold = coldEngine.generate(events, "", {
      eventGraph: graph,
      eventOrder: events,
      collectTransformedOperations: false,
    });
    const ropeStats = PersistentUtf16Rope.getInstrumentation();

    expect(cold.text).toBe(eager.text);
    expect(coldEngine.getSequenceRecords()).toEqual(
      eagerEngine.getSequenceRecords(),
    );
    expect(coldEngine.getDeleteTargetRecords()).toEqual(
      eagerEngine.getDeleteTargetRecords(),
    );
    expect(cold.stats.sequenceTreeOperations).toBeLessThan(
      eager.stats.sequenceTreeOperations,
    );
    expect(ropeStats.joins).toBe(0);
    expect(ropeStats.splits).toBe(0);

    const next: GraphEvent = {
      id: "merge:0",
      parentVersion: graph.getFrontier(),
      operation: {
        type: OPERATION_TYPE.INSERT,
        index: cold.text.length,
        text: "!",
      },
      timestamp: 4,
    };
    graph.addEvent(next);

    const eagerApplied = eagerEngine.applyEvent(next, graph);
    const coldApplied = coldEngine.applyEvent(next, graph);
    expect(coldApplied.text).toBe(eagerApplied.text);
    expect(coldApplied.transformedOperations).toEqual(
      eagerApplied.transformedOperations,
    );
  });

  it("defers a large checkpoint suffix while retaining checkpoint leaves", () => {
    const checkpointText = "x".repeat(2_048 * 64);
    const checkpointBuffer = PersistentUtf16Rope.from(checkpointText);
    const checkpointLeaves = new Set(checkpointBuffer.getLeafIdentities());
    const root: GraphEvent = {
      id: "root:0",
      parentVersion: new Set(),
      operation: {
        type: OPERATION_TYPE.INSERT,
        index: 0,
        text: checkpointText,
      },
      timestamp: 0,
    };
    const events = Array.from(
      { length: 96 },
      (_, index): GraphEvent => ({
        id: `suffix:${index}`,
        parentVersion: new Set([index === 0 ? root.id : `suffix:${index - 1}`]),
        operation: {
          type: OPERATION_TYPE.INSERT,
          index: checkpointText.length + index,
          text: "!",
        },
        timestamp: index + 1,
      }),
    );
    const graph = EventGraph.fromEvents([root, ...events]);

    const eagerEngine = new EgWalkerEngine();
    const eager = eagerEngine.generate(events, "", {
      initialVersion: new Set([root.id]),
      initialTextBuffer: checkpointBuffer,
      eventGraph: graph,
      eventOrder: events,
    });
    PersistentUtf16Rope.resetInstrumentation();
    const deferredEngine = new EgWalkerEngine();
    const deferred = deferredEngine.generate(events, "", {
      initialVersion: new Set([root.id]),
      initialTextBuffer: checkpointBuffer,
      eventGraph: graph,
      eventOrder: events,
      collectTransformedOperations: false,
    });
    const ropeStats = PersistentUtf16Rope.getInstrumentation();
    const sharedLeaves = deferred.textBuffer
      .getLeafIdentities()
      .filter((candidate) => checkpointLeaves.has(candidate));

    expect(deferred.text).toBe(eager.text);
    expect(deferred.stats.sequenceTreeOperations).toBeLessThan(
      eager.stats.sequenceTreeOperations,
    );
    expect(sharedLeaves).toHaveLength(checkpointLeaves.size);
    expect(ropeStats).toMatchObject({
      joins: 0,
      splits: 0,
      flattenCount: 0,
      flattenedCodeUnits: 0,
    });

    const next: GraphEvent = {
      id: "suffix:96",
      parentVersion: new Set(["suffix:95"]),
      operation: {
        type: OPERATION_TYPE.INSERT,
        index: deferred.textBuffer.length,
        text: "?",
      },
      timestamp: 97,
    };
    graph.addEvent(next);
    const applied = deferredEngine.applyEvent(next, graph);
    expect(applied.text).toBe(`${deferred.text}?`);
    expect(applied.transformedOperations).toEqual([
      {
        type: OPERATION_TYPE.INSERT,
        index: deferred.textBuffer.length,
        text: "?",
      },
    ]);
  });

  it("keeps a tiny checkpoint suffix on the eager splice path", () => {
    const checkpointBuffer = PersistentUtf16Rope.from("x".repeat(8_192));
    const root: GraphEvent = {
      id: "root:0",
      parentVersion: new Set(),
      operation: {
        type: OPERATION_TYPE.INSERT,
        index: 0,
        text: "x".repeat(8_192),
      },
      timestamp: 0,
    };
    const event: GraphEvent = {
      id: "suffix:0",
      parentVersion: new Set([root.id]),
      operation: {
        type: OPERATION_TYPE.INSERT,
        index: checkpointBuffer.length,
        text: "!",
      },
      timestamp: 1,
    };
    const graph = EventGraph.fromEvents([root, event]);
    PersistentUtf16Rope.resetInstrumentation();

    const generated = new EgWalkerEngine().generate([event], "", {
      initialVersion: new Set([root.id]),
      initialTextBuffer: checkpointBuffer,
      eventGraph: graph,
      eventOrder: [event],
      collectTransformedOperations: false,
    });

    expect(generated.text).toBe(`${"x".repeat(8_192)}!`);
    expect(PersistentUtf16Rope.getInstrumentation().joins).toBe(1);
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

  it("rejects deletes that run past the parent document", () => {
    expect(() =>
      new EgWalkerEngine().generate(
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
      ),
    ).toThrow(/exceeds parent document length 1/);
  });

  it("exports sequence records for snapshot restore plumbing", () => {
    const engine = new EgWalkerEngine();
    engine.generate([
      {
        id: "alice:0",
        parentVersion: new Set(),
        operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "A" },
        timestamp: 1,
      },
      {
        id: "alice:1",
        parentVersion: new Set(["alice:0"]),
        operation: { type: OPERATION_TYPE.INSERT, index: 1, text: "B" },
        timestamp: 2,
      },
      {
        id: "bob:0",
        parentVersion: new Set(["alice:1"]),
        operation: { type: OPERATION_TYPE.INSERT, index: 2, text: "C" },
        timestamp: 3,
      },
    ]);

    const records = engine.getSequenceRecords();

    expect(records).toEqual([
      {
        id: "alice:0:0",
        eventId: "alice:0",
        content: "AB",
        originLeft: null,
        originRight: null,
        everDeleted: false,
        prepareState: 1,
        run: { replicaId: "alice", startSequence: 0 },
      },
      {
        id: "bob:0:0",
        eventId: "bob:0",
        content: "C",
        originLeft: "alice:0:0",
        originRight: null,
        everDeleted: false,
        prepareState: 1,
        run: { replicaId: "bob", startSequence: 0 },
      },
    ]);

    engine.applyEvent(
      {
        id: "bob:1",
        parentVersion: new Set(["bob:0"]),
        operation: { type: OPERATION_TYPE.INSERT, index: 3, text: "D" },
        timestamp: 4,
      },
      EventGraph.fromEvents([
        {
          id: "alice:0",
          parentVersion: new Set(),
          operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "A" },
          timestamp: 1,
        },
        {
          id: "alice:1",
          parentVersion: new Set(["alice:0"]),
          operation: { type: OPERATION_TYPE.INSERT, index: 1, text: "B" },
          timestamp: 2,
        },
        {
          id: "bob:0",
          parentVersion: new Set(["alice:1"]),
          operation: { type: OPERATION_TYPE.INSERT, index: 2, text: "C" },
          timestamp: 3,
        },
        {
          id: "bob:1",
          parentVersion: new Set(["bob:0"]),
          operation: { type: OPERATION_TYPE.INSERT, index: 3, text: "D" },
          timestamp: 4,
        },
      ]),
    );

    expect(records[1]?.content).toBe("C");
    expect(engine.getSequenceRecords()[1]?.content).toBe("CD");
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

  it("orders concurrent inserts at the same origin by event id (YATA tie-break)", () => {
    // Two concurrent inserts (`z:0` and `a:0`) share the same parent
    // version `{root:0}` and target the same logical position. The
    // engine now anchors them against their parent-version view
    // (originLeft=null, originRight=root char) instead of the current
    // sequence, so both end up in the same conflict region and are
    // ordered by event id: `a:0` < `z:0`, so A is placed before Z.
    //
    // This is the YATA / Yjs tie-break (lower client id wins) and the
    // engine produces the same text regardless of which order Kahn /
    // branch-preserving / random topological traversals deliver the
    // events in — see the property tests below.
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

    expect(generated.text).toBe("AZX");
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

describe("branch-preserving topological traversal", () => {
  it("reduces retreat/advance churn versus Kahn on parallel branches", () => {
    // Build B parallel chains of length L forking off a common root,
    // with ids assigned in BFS / level order so the lex tie-breaker
    // forces Kahn into a fully interleaved traversal:
    //   level 0: n-00
    //   level 1: n-01..n-04 (children of n-00)
    //   level 2: n-05..n-08 (n-05 child of n-01, n-06 of n-02, ...)
    // Kahn's sorted ready queue ends up popping n-01, n-02, n-03, n-04
    // before any level-2 event, so the engine has to retreat the
    // previous branch and advance the next on every transition. The
    // branch-preserving DFS instead walks n-01 → n-05 → n-09 before
    // ever popping n-02, so retreats only happen at branch boundaries.
    const branches = 4;
    const depth = 6;
    const graph = new EventGraph();
    const idAt = (level: number, branch: number): EventId =>
      `n-${String(level * branches + branch).padStart(3, "0")}`;
    graph.addEvent({
      id: "n-000",
      parentVersion: new Set(),
      operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "R" },
      timestamp: 0,
    });
    for (let level = 0; level < depth; level++) {
      for (let branch = 0; branch < branches; branch++) {
        const id = idAt(level + 1, branch);
        const parent = level === 0 ? "n-000" : idAt(level, branch);
        graph.addEvent({
          id,
          parentVersion: new Set([parent]),
          operation: { type: OPERATION_TYPE.INSERT, index: 1, text: "x" },
          timestamp: 1 + level * branches + branch,
        });
      }
    }

    const branchPreservingOrder = graph.getBranchPreservingTopologicalOrder();
    const kahnOrder = graph.getTopologicalOrder();

    // Sanity-check that the legacy ordering really did interleave the
    // branches: the first four post-root entries are the level-1
    // events from each branch.
    expect(kahnOrder.slice(1, 1 + branches).map((event) => event.id)).toEqual([
      idAt(1, 0),
      idAt(1, 1),
      idAt(1, 2),
      idAt(1, 3),
    ]);
    // And the branch-preserving DFS keeps the first branch contiguous.
    expect(
      branchPreservingOrder.slice(1, 1 + depth).map((event) => event.id),
    ).toEqual([
      idAt(1, 0),
      idAt(2, 0),
      idAt(3, 0),
      idAt(4, 0),
      idAt(5, 0),
      idAt(6, 0),
    ]);

    const branchStats = new EgWalkerEngine().generate(
      branchPreservingOrder,
      "",
      { eventGraph: graph },
    ).stats;
    const kahnStats = new EgWalkerEngine().generate(kahnOrder, "", {
      eventGraph: graph,
    }).stats;

    const branchChurn = branchStats.retreatCount + branchStats.advanceCount;
    const kahnChurn = kahnStats.retreatCount + kahnStats.advanceCount;
    expect(branchChurn).toBeLessThan(kahnChurn);
  });

  it("eliminates retreats entirely on a single deep chain", () => {
    // A purely linear history has exactly one valid topological order,
    // and the engine must never retreat because each event's
    // parentVersion already matches the current version. Both methods
    // return the same order in this case, so the assertion holds for
    // each.
    const graph = new EventGraph();
    for (let i = 0; i < 50; i++) {
      graph.addEvent({
        id: `n-${i}`,
        parentVersion: i === 0 ? new Set() : new Set([`n-${i - 1}`]),
        operation: { type: OPERATION_TYPE.INSERT, index: i, text: "x" },
        timestamp: i,
      });
    }

    const kahnStats = new EgWalkerEngine().generate(
      graph.getTopologicalOrder(),
      "",
      { eventGraph: graph },
    ).stats;
    const branchStats = new EgWalkerEngine().generate(
      graph.getBranchPreservingTopologicalOrder(),
      "",
      { eventGraph: graph },
    ).stats;
    expect(kahnStats.retreatCount).toBe(0);
    expect(kahnStats.advanceCount).toBe(0);
    expect(branchStats.retreatCount).toBe(0);
    expect(branchStats.advanceCount).toBe(0);
  });

  it("produces the same text across Kahn and branch-preserving traversals", () => {
    // Two concurrent root inserts (a:0, b:0) plus a descendant of one
    // of them (c:0 under a:0). The YATA-style integration scan anchors
    // items against their parent-version view, so the same event graph
    // produces the same text regardless of which valid topological
    // order the caller hands the engine.
    const graph = new EventGraph();
    graph.addEvent({
      id: "a:0",
      parentVersion: new Set(),
      operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "A" },
      timestamp: 1,
    });
    graph.addEvent({
      id: "b:0",
      parentVersion: new Set(),
      operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "B" },
      timestamp: 2,
    });
    graph.addEvent({
      id: "c:0",
      parentVersion: new Set(["a:0"]),
      operation: { type: OPERATION_TYPE.INSERT, index: 1, text: "C" },
      timestamp: 3,
    });

    // Kahn-lex visits a, b, c (lexicographic tie-break on ready set).
    const kahnOrderIds = graph.getTopologicalOrder().map((event) => event.id);
    expect(kahnOrderIds).toEqual(["a:0", "b:0", "c:0"]);
    // The branch-preserving DFS visits the one-event b branch first, then
    // leaves the longer a/c branch applied as the final root traversal.
    const branchOrderIds = graph
      .getBranchPreservingTopologicalOrder()
      .map((event) => event.id);
    expect(branchOrderIds).toEqual(["b:0", "a:0", "c:0"]);

    const kahnText = new EgWalkerEngine().generate(
      graph.getTopologicalOrder(),
      "",
      { eventGraph: graph },
    ).text;
    const branchText = new EgWalkerEngine().generate(
      graph.getBranchPreservingTopologicalOrder(),
      "",
      { eventGraph: graph },
    ).text;
    // Both traversals are valid topological orders of the same DAG and
    // must agree on the final text.
    expect(kahnText).toBe(branchText);
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
