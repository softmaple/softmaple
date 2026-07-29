import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  convertPaperTraceToCausalBatches,
  loadPaperTraceCausalBatches,
  streamPaperTraceToCausalBatches,
} from "../bench/paper-trace-causal-batches";
import type { PaperTrace } from "../bench/paper-traces";
import { OPERATION_TYPE, type GraphEvent } from "@softmaple/eg-walker";
import {
  convertPaperTraceToAtomicEvents,
  inspectCausalEventBatch,
} from "@softmaple/eg-walker/internal";

const branchingTrace: PaperTrace = {
  kind: "concurrent",
  endContent: "",
  numAgents: 4,
  txns: [
    {
      parents: [],
      numChildren: 2,
      agent: 0,
      patches: [[0, 0, "A"]],
      _dtSpan: [0, 1],
    },
    {
      parents: [0],
      numChildren: 1,
      agent: 1,
      patches: [[1, 0, "BC"]],
      _dtSpan: [1, 3],
    },
    {
      parents: [0],
      numChildren: 1,
      agent: 2,
      patches: [[1, 0, "D"]],
      _dtSpan: [3, 4],
    },
    {
      parents: [1, 2],
      numChildren: 0,
      agent: 3,
      patches: [[0, 0, "E"]],
      _dtSpan: [4, 5],
    },
  ],
};

const mergedUnicodeTrace: PaperTrace = {
  kind: "concurrent",
  endContent: "A😀B!",
  numAgents: 4,
  txns: [
    {
      parents: [],
      numChildren: 2,
      agent: 0,
      patches: [[0, 0, "😀"]],
    },
    {
      parents: [0],
      numChildren: 1,
      agent: 1,
      patches: [[0, 0, "A"]],
    },
    {
      parents: [0],
      numChildren: 1,
      agent: 2,
      patches: [[1, 0, "B"]],
    },
    {
      parents: [1, 2],
      numChildren: 0,
      agent: 3,
      patches: [[3, 0, "!"]],
    },
  ],
};

const inspectBatches = (
  batches: ReturnType<typeof convertPaperTraceToCausalBatches>["batches"],
): GraphEvent[] =>
  batches.flatMap((batch) => [...inspectCausalEventBatch(batch)]);

describe("paper trace causal batches", () => {
  it("matches the established atomic event conversion", () => {
    const expected = convertPaperTraceToAtomicEvents("C1", branchingTrace, {
      validateFinalText: false,
    });

    const converted = convertPaperTraceToCausalBatches(
      "C1",
      branchingTrace,
      "all",
    );

    expect(converted.batchCount).toBe(1);
    expect(converted.eventCount).toBe(5);
    expect(converted.limited).toBe(false);
    expect(inspectBatches(converted.batches)).toEqual(expected);
  });

  it("preserves scalar-to-UTF-16 offsets for a merged Unicode trace", () => {
    const expected = convertPaperTraceToAtomicEvents("C1", mergedUnicodeTrace);

    const converted = convertPaperTraceToCausalBatches(
      "C1",
      mergedUnicodeTrace,
      "all",
      { validateFinalText: true },
    );

    expect(inspectBatches(converted.batches)).toEqual(expected);
    expect(inspectBatches(converted.batches).at(-1)?.operation).toEqual({
      type: OPERATION_TYPE.INSERT,
      index: 4,
      text: "!",
    });
  });

  it("keeps transaction versions intact across bounded batch boundaries", () => {
    const converted = convertPaperTraceToCausalBatches("C1", branchingTrace, 2);
    const events = inspectBatches(converted.batches);

    expect(converted.batches.map(({ eventCount }) => eventCount)).toEqual([
      2, 2, 1,
    ]);
    expect(events[2]?.parentVersion).toEqual(new Set([events[1]!.id]));
    expect(events[3]?.parentVersion).toEqual(new Set([events[0]!.id]));
    expect(events[4]?.parentVersion).toEqual(
      new Set([events[2]!.id, events[3]!.id]),
    );
    expect(converted.frontier).toEqual(new Set([events[4]!.id]));
  });

  it("stops at maxEvents without losing concurrent frontier heads", () => {
    const converted = convertPaperTraceToCausalBatches(
      "C1",
      branchingTrace,
      2,
      { maxEvents: 4 },
    );
    const events = inspectBatches(converted.batches);

    expect(converted.batches.map(({ eventCount }) => eventCount)).toEqual([
      2, 2,
    ]);
    expect(converted.eventCount).toBe(4);
    expect(converted.limited).toBe(true);
    expect(converted.frontier).toEqual(new Set([events[2]!.id, events[3]!.id]));
  });

  it("streams completed batches without retaining a batch list", () => {
    const deliveredEventCounts: number[] = [];

    const summary = streamPaperTraceToCausalBatches(
      "C1",
      branchingTrace,
      3,
      (batch) => deliveredEventCounts.push(batch.eventCount),
    );

    expect(deliveredEventCounts).toEqual([3, 2]);
    expect(summary).toMatchObject({
      batchCount: 2,
      eventCount: 5,
      limited: false,
    });
  });

  it.each([
    0,
    -1,
    1.5,
    Number.POSITIVE_INFINITY,
  ])("rejects invalid batch size %s", (batchEvents) => {
    expect(() =>
      convertPaperTraceToCausalBatches("C1", branchingTrace, batchEvents),
    ).toThrow(/batch size must be a positive safe integer or all/);
  });

  it("loads a transaction-limited trace directly into causal batches", () => {
    const paperRoot = mkdtempSync(join(tmpdir(), "eg-walker-paper-traces-"));
    try {
      mkdirSync(join(paperRoot, "datasets"));
      writeFileSync(
        join(paperRoot, "datasets", "C1.json"),
        JSON.stringify(branchingTrace),
      );

      const loaded = loadPaperTraceCausalBatches(paperRoot, "C1", {
        batchEvents: "all",
        maxTxns: 2,
      });

      expect(loaded.txnCount).toBe(2);
      expect(loaded.patchCount).toBe(2);
      expect(loaded.eventCount).toBe(3);
      expect(loaded.batchCount).toBe(1);
      expect(loaded.limited).toBe(true);
      expect(inspectBatches(loaded.batches)).toEqual(
        convertPaperTraceToAtomicEvents(
          "C1",
          { ...branchingTrace, txns: branchingTrace.txns.slice(0, 2) },
          { validateFinalText: false },
        ),
      );
    } finally {
      rmSync(paperRoot, { recursive: true, force: true });
    }
  });
});
