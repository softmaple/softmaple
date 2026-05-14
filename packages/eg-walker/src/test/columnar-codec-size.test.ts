/**
 * Size benchmarks for {@link ColumnarEventGraphCodec.encodeBinary} against the
 * baseline `JSON.stringify(graph.serialize())` event-graph representation.
 *
 * Issue: softmaple/softmaple#672 ("Improve columnar codec compression toward
 * the paper's storage model").
 *
 * The point of these tests is twofold:
 *
 *   1. **Regression guard on the EGW3 wire format.** Each trace asserts a
 *      hard upper bound on the ratio `binaryBytes / jsonBytes`. The bounds
 *      are loose enough to absorb future single-byte-per-event churn but
 *      tight enough that re-introducing one of the redundant columns
 *      (`textLengths`, run `startEventOffset`, absolute timestamps, ...)
 *      would fail at least one assertion.
 *
 *   2. **Coverage of realistic editing traces.** The issue specifically calls
 *      out that the previous performance story was anchored on
 *      insert-heavy synthetic traces. These tests exercise four trace
 *      families:
 *
 *      - `buildLinearInsertTrace`        - single-author, append-only.
 *      - `buildEditingTrace`             - single-author, mixed insert/delete
 *                                          with backspace + retype churn.
 *      - `buildBulkPasteThenEditTrace`   - one large insert followed by many
 *                                          small inserts and deletes (paste +
 *                                          cleanup).
 *      - `buildConcurrentMergeTrace`     - two authors with periodic merge
 *                                          events; exercises the
 *                                          parentOverrides column.
 *
 *      Every trace also round-trips through `decodeBinary` and is compared
 *      against the expected text via `EgWalkerEngine.generate`, so a smaller
 *      binary that no longer decodes correctly will fail before the size
 *      assertion fires.
 */

import { describe, expect, it } from "vitest";

import { OPERATION_TYPE } from "../constants/operation-types";
import { EgWalkerEngine } from "../engine/eg-walker-engine";
import { ColumnarEventGraphCodec } from "../graph/columnar-codec";
import { EventGraph } from "../graph/event-graph";
import type { EventId } from "../types";

interface TraceMetrics {
  readonly traceName: string;
  readonly events: number;
  readonly jsonBytes: number;
  readonly binaryBytes: number;
  readonly ratio: number;
}

const utf8Bytes = (text: string): number =>
  new TextEncoder().encode(text).length;

const measure = (
  graph: EventGraph,
): Omit<TraceMetrics, "traceName" | "events"> => {
  const codec = new ColumnarEventGraphCodec();
  const jsonBytes = utf8Bytes(JSON.stringify(graph.serialize()));
  const binaryBytes = codec.encodeBinary(graph).byteLength;
  return { jsonBytes, binaryBytes, ratio: binaryBytes / jsonBytes };
};

const expectedTextFromTrace = (graph: EventGraph): string =>
  new EgWalkerEngine().generate(graph.getTopologicalOrder()).text;

const createPrng = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
};

const buildLinearInsertTrace = (eventCount: number): EventGraph => {
  const graph = new EventGraph();
  const baseTimestamp = 1_778_000_000_000;
  let parent: EventId | null = null;
  let cursor = 0;
  const prng = createPrng(1);
  for (let i = 0; i < eventCount; i++) {
    const id = `linear:${i}`;
    const ch = String.fromCharCode(0x61 + Math.floor(prng() * 26));
    graph.addEvent({
      id,
      parentVersion: new Set<EventId>(parent ? [parent] : []),
      operation: { type: OPERATION_TYPE.INSERT, index: cursor, text: ch },
      timestamp: baseTimestamp + i,
    });
    parent = id;
    cursor += 1;
  }
  return graph;
};

const buildEditingTrace = (eventCount: number): EventGraph => {
  // Simulates "type a word, occasionally backspace and retype" editing
  // sessions. Roughly 70% INSERTs / 30% DELETEs, with positions clustered
  // around a moving cursor rather than appended at the end.
  const graph = new EventGraph();
  const baseTimestamp = 1_778_000_000_000;
  const prng = createPrng(7);
  let parent: EventId | null = null;
  let length = 0;
  let cursor = 0;
  for (let i = 0; i < eventCount; i++) {
    const id = `edit:${i}`;
    // Move the cursor in small, locally-clustered steps so the
    // operationIndexes delta stays small (single byte zigzag varint).
    const jitter = Math.floor(prng() * 5) - 2;
    cursor = Math.max(0, Math.min(length, cursor + jitter));
    const wantDelete = prng() < 0.3 && length > 0;
    if (wantDelete) {
      const deleteLen = Math.min(length - cursor, 1 + Math.floor(prng() * 3));
      if (deleteLen <= 0) {
        // Fall through to insert when there's nothing to delete here.
        const ch = String.fromCharCode(0x61 + Math.floor(prng() * 26));
        graph.addEvent({
          id,
          parentVersion: new Set<EventId>(parent ? [parent] : []),
          operation: { type: OPERATION_TYPE.INSERT, index: cursor, text: ch },
          timestamp: baseTimestamp + i,
        });
        length += 1;
        cursor += 1;
      } else {
        graph.addEvent({
          id,
          parentVersion: new Set<EventId>(parent ? [parent] : []),
          operation: {
            type: OPERATION_TYPE.DELETE,
            index: cursor,
            length: deleteLen,
          },
          timestamp: baseTimestamp + i,
        });
        length -= deleteLen;
      }
    } else {
      const word = "word" + String.fromCharCode(0x61 + Math.floor(prng() * 26));
      graph.addEvent({
        id,
        parentVersion: new Set<EventId>(parent ? [parent] : []),
        operation: {
          type: OPERATION_TYPE.INSERT,
          index: cursor,
          text: word,
        },
        timestamp: baseTimestamp + i,
      });
      length += word.length;
      cursor += word.length;
    }
    parent = id;
  }
  return graph;
};

const buildBulkPasteThenEditTrace = (
  pasteChars: number,
  editEventCount: number,
): EventGraph => {
  const graph = new EventGraph();
  const baseTimestamp = 1_778_000_000_000;
  const prng = createPrng(11);
  // One large initial paste. Mostly-random ASCII so LZ4 has something to
  // compress without trivially collapsing to a constant block.
  const pasteText = Array.from({ length: pasteChars }, () =>
    String.fromCharCode(0x21 + Math.floor(prng() * 94)),
  ).join("");
  graph.addEvent({
    id: "paste:0",
    parentVersion: new Set(),
    operation: { type: OPERATION_TYPE.INSERT, index: 0, text: pasteText },
    timestamp: baseTimestamp,
  });
  let parent: EventId = "paste:0";
  let length = pasteChars;
  let cursor = Math.floor(pasteChars / 2);
  for (let i = 0; i < editEventCount; i++) {
    const id = `cleanup:${i}`;
    const jitter = Math.floor(prng() * 7) - 3;
    cursor = Math.max(0, Math.min(length, cursor + jitter));
    if (prng() < 0.5 && length > 0) {
      const deleteLen = Math.min(length - cursor, 1 + Math.floor(prng() * 4));
      graph.addEvent({
        id,
        parentVersion: new Set<EventId>([parent]),
        operation: {
          type: OPERATION_TYPE.DELETE,
          index: cursor,
          length: Math.max(1, deleteLen),
        },
        timestamp: baseTimestamp + 1 + i,
      });
      length -= Math.max(1, deleteLen);
    } else {
      const ch = String.fromCharCode(0x61 + Math.floor(prng() * 26));
      graph.addEvent({
        id,
        parentVersion: new Set<EventId>([parent]),
        operation: { type: OPERATION_TYPE.INSERT, index: cursor, text: ch },
        timestamp: baseTimestamp + 1 + i,
      });
      length += 1;
      cursor += 1;
    }
    parent = id;
  }
  return graph;
};

const buildConcurrentMergeTrace = (
  eventsPerAuthor: number,
  mergeEveryN: number,
): EventGraph => {
  // Two authors edit independently in chunks of `mergeEveryN` events, then a
  // synthetic merge event references both branches. This is the worst case
  // for parentOverrides density (one override per merge) and exercises the
  // monotonic-delta encoding of override offsets.
  const graph = new EventGraph();
  const baseTimestamp = 1_778_000_000_000;
  let aParent: EventId | null = null;
  let bParent: EventId | null = null;
  let aLen = 0;
  let bLen = 0;
  for (let i = 0; i < eventsPerAuthor; i++) {
    const aId = `alice:${i}`;
    graph.addEvent({
      id: aId,
      parentVersion: new Set<EventId>(aParent ? [aParent] : []),
      operation: { type: OPERATION_TYPE.INSERT, index: aLen, text: "a" },
      timestamp: baseTimestamp + 2 * i,
    });
    aParent = aId;
    aLen += 1;

    const bId = `bob:${i}`;
    graph.addEvent({
      id: bId,
      parentVersion: new Set<EventId>(bParent ? [bParent] : []),
      operation: { type: OPERATION_TYPE.INSERT, index: bLen, text: "b" },
      timestamp: baseTimestamp + 2 * i + 1,
    });
    bParent = bId;
    bLen += 1;

    if ((i + 1) % mergeEveryN === 0 && aParent && bParent) {
      const mergeId = `merge:${i}`;
      graph.addEvent({
        id: mergeId,
        parentVersion: new Set<EventId>([aParent, bParent]),
        operation: {
          type: OPERATION_TYPE.INSERT,
          index: 0,
          text: "|",
        },
        timestamp: baseTimestamp + 2 * i + 2,
      });
      aParent = mergeId;
      bParent = mergeId;
    }
  }
  return graph;
};

describe("columnar codec size benchmarks (issue #672)", () => {
  const results: TraceMetrics[] = [];

  const benchmark = (
    traceName: string,
    graph: EventGraph,
    maxRatio: number,
  ): void => {
    const codec = new ColumnarEventGraphCodec();

    // Round-trip integrity: a smaller payload that doesn't decode correctly
    // is not a real win.
    const decoded = codec.decodeBinary(codec.encodeBinary(graph));
    expect(decoded.getTopologicalOrder().map((event) => event.id)).toEqual(
      graph.getTopologicalOrder().map((event) => event.id),
    );
    expect(expectedTextFromTrace(decoded)).toBe(expectedTextFromTrace(graph));

    const { jsonBytes, binaryBytes, ratio } = measure(graph);
    results.push({
      traceName,
      events: graph.getAllEvents().length,
      jsonBytes,
      binaryBytes,
      ratio,
    });

    expect(binaryBytes).toBeLessThan(jsonBytes);
    expect(ratio).toBeLessThan(maxRatio);
  };

  it("compresses a single-author linear insert trace well below the JSON baseline", () => {
    // Append-only single-char inserts: every column either delta-encodes to
    // 1 byte (operationIndexes/timestamps), is a singleton run
    // (operationRuns/idRuns), or compresses very densely (LZ4 on a
    // pseudo-random ASCII stream). The JSON form, by contrast, carries the
    // full ms-since-epoch timestamps and absolute indexes per event.
    benchmark("linear-1k", buildLinearInsertTrace(1_000), 0.1);
  });

  it("compresses a single-author mixed-edit trace well below the JSON baseline", () => {
    // Mixed insert/delete trace with cursor jitter. operationIndexes deltas
    // are small (~+/-5) but no longer constant; operationRuns flip between
    // INSERT and DELETE every few events. Still expected to be well under
    // half of the JSON size.
    benchmark("editing-2k", buildEditingTrace(2_000), 0.15);
  });

  it("compresses a bulk-paste-then-edit trace well below the JSON baseline", () => {
    // One large LZ4-friendly insert dominates the payload. The JSON form
    // pays for the full text twice (once as `text`, once as JSON-encoded
    // string overhead) plus per-event scaffolding.
    benchmark(
      "bulk-paste-4k+200-edits",
      buildBulkPasteThenEditTrace(4_096, 200),
      0.25,
    );
  });

  it("compresses a multi-author concurrent-merge trace below the JSON baseline", () => {
    // Worst case for our format: dense parentOverrides (one per 5 events
    // for alice+bob+merge triples). The monotonic-delta encoding keeps
    // override offsets small and idRuns RLE collapses each author's
    // sequence into one run.
    benchmark("concurrent-merge-2x500", buildConcurrentMergeTrace(500, 5), 0.2);
  });

  it("logs a summary table so the size numbers show up in CI logs", () => {
    // The summary log is deliberately last so it captures every prior
    // benchmark. It's informational only - the hard assertions live on
    // each individual case.
    expect(results.length).toBeGreaterThanOrEqual(4);
    const summary = results
      .map(
        ({ traceName, events, jsonBytes, binaryBytes, ratio }) =>
          `${traceName.padEnd(28)} events=${String(events).padStart(5)} ` +
          `json=${String(jsonBytes).padStart(7)}B ` +
          `binary=${String(binaryBytes).padStart(7)}B ` +
          `ratio=${ratio.toFixed(3)}`,
      )
      .join("\n");
    console.info(
      `\nEGW3 binary vs JSON.stringify(serialize()) sizes:\n${summary}\n`,
    );
  });
});
