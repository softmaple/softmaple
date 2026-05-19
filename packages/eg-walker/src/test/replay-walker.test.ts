import { describe, expect, it } from "vitest";
import { OPERATION_TYPE } from "../constants/operation-types";
import { ReplayWalker } from "../core/replay-walker";
import type { GraphEvent } from "../types";

describe("ReplayWalker", () => {
  it("walks events through the engine and exposes final versions", () => {
    const walker = new ReplayWalker({ initialText: "Hi" });
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
    const walker = new ReplayWalker();
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
    const walker = new ReplayWalker({ initialText: "seed" });

    expect(walker.walk([])).toEqual({
      finalText: "seed",
      eventsProcessed: 0,
      retreatCount: 0,
      advanceCount: 0,
      nonConflictingRunCount: 0,
      fullReplayCount: 0,
      // The engine seeds the initial-text placeholder during `reset` and
      // samples the peak right after, so even an empty event list reports
      // 1 live record.
      peakSequenceRecordCount: 1,
    });
    expect(walker.getPrepareVersion()).toEqual(new Set());
    expect(walker.getEffectVersion()).toEqual(new Set());
  });

  it("defaults walker initial text to an empty string", () => {
    const result = new ReplayWalker().walk([
      {
        id: "alice:0",
        parentVersion: new Set(),
        operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "A" },
        timestamp: 1,
      },
    ] as GraphEvent[]);

    expect(result.finalText).toBe("A");
  });
});
