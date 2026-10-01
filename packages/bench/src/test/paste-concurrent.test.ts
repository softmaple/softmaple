import { describe, expect, it } from "vitest";

import { EgWalkerReplica } from "@softmaple/eg-walker";
import { measurePasteConcurrent, pasteText } from "../bench/paste-concurrent";

const fakeMemory = (
  samples: ReadonlyArray<{ heapUsed: number; arrayBuffers: number }>,
) => {
  let index = 0;
  return () => {
    const sample = samples[index++];
    if (sample === undefined) {
      throw new Error("unexpected memory sample");
    }
    return sample;
  };
};

describe("concurrent paste merge", () => {
  it("merges a paste with a concurrent keystroke on both sides", () => {
    let collections = 0;
    const result = measurePasteConcurrent(
      { EgWalkerReplica },
      {
        pasteLength: 500,
        baseLength: 40,
        warmup: 0,
        collectGarbage: () => {
          collections++;
        },
        memoryUsage: fakeMemory([
          { heapUsed: 1_000, arrayBuffers: 100 },
          { heapUsed: 4_000, arrayBuffers: 300 },
          { heapUsed: 4_000, arrayBuffers: 300 },
          { heapUsed: 9_000, arrayBuffers: 600 },
        ]),
      },
    );

    expect(collections).toBe(8);
    expect(result).toMatchObject({
      pasteLength: 500,
      baseLength: 40,
      paster: { heapBytes: 3_000, arrayBufferBytes: 200 },
      editor: { heapBytes: 5_000, arrayBufferBytes: 300 },
    });
    for (const side of [result.paster, result.editor]) {
      expect(side.mergeMs).toBeGreaterThanOrEqual(0);
      expect(side.sequenceRecordCount).toBeGreaterThan(0);
      expect(side.peakSequenceRecordCount).toBeGreaterThanOrEqual(
        side.sequenceRecordCount,
      );
      expect(side.fullReplays + side.partialReplays).toBeGreaterThan(0);
    }
  });

  it("builds deterministic paste text", () => {
    expect(pasteText(5)).toBe("alwfq");
    expect(pasteText(100_000)).toHaveLength(100_000);
  });

  it("rejects invalid sizes and warm-up counts", () => {
    const collectGarbage = () => undefined;
    expect(() =>
      measurePasteConcurrent(
        { EgWalkerReplica },
        { pasteLength: 1, baseLength: 40, warmup: 0, collectGarbage },
      ),
    ).toThrow("paste length must be an integer of at least 2");
    expect(() =>
      measurePasteConcurrent(
        { EgWalkerReplica },
        { pasteLength: 10, baseLength: 3, warmup: 0, collectGarbage },
      ),
    ).toThrow("base length must be an integer of at least 4");
    expect(() =>
      measurePasteConcurrent(
        { EgWalkerReplica },
        { pasteLength: 10, baseLength: 40, warmup: -1, collectGarbage },
      ),
    ).toThrow("warm-up rounds must be a non-negative integer");
  });
});
