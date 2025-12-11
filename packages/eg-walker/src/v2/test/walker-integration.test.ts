/**
 * Integration tests for Section 3.2 — Walking the Event Graph
 * Verify the complete walker flow with retreat/advance
 */

import { describe, it, expect } from "vitest";
import { EgWalker } from "../core/walker";
import { EventGraph } from "../graph/event-graph";
import type { GraphEvent } from "../graph/event-graph";
import { StubInternalCRDT } from "../crdt/retreat-advance-stubs";

describe("Section 3.2: EgWalker Integration", () => {
  it("should process sequential events without retreat/advance", () => {
    const walker = new EgWalker();

    const events: GraphEvent[] = [
      {
        id: "e1",
        parentVersion: new Set(),
        operation: { type: "insert", index: 0, text: "a" },
        timestamp: Date.now(),
      },
      {
        id: "e2",
        parentVersion: new Set(["e1"]),
        operation: { type: "insert", index: 1, text: "b" },
        timestamp: Date.now() + 1,
      },
    ];

    const result = walker.walk(events);

    expect(result.eventsProcessed).toBe(2);
    expect(result.retreatCount).toBe(0);
    // For sequential events where prepareVersion already equals effectVersion,
    // no advance is needed (they are applied directly in sequence)
    expect(result.advanceCount).toBe(0);
  });

  it("should handle simple concurrency with retreat/advance", () => {
    const internalCRDT = new StubInternalCRDT();
    const walker = new EgWalker({ internalCRDT });

    const events: GraphEvent[] = [
      {
        id: "base",
        parentVersion: new Set(),
        operation: { type: "insert", index: 0, text: "base" },
        timestamp: Date.now(),
      },
      {
        id: "a1",
        parentVersion: new Set(["base"]),
        operation: { type: "insert", index: 1, text: "a1" },
        timestamp: Date.now() + 1,
      },
      {
        id: "b1",
        parentVersion: new Set(["base"]),
        operation: { type: "insert", index: 1, text: "b1" },
        timestamp: Date.now() + 2,
      },
      {
        id: "merge",
        parentVersion: new Set(["a1", "b1"]),
        operation: { type: "insert", index: 2, text: "merge" },
        timestamp: Date.now() + 3,
      },
    ];

    const result = walker.walk(events);

    expect(result.eventsProcessed).toBe(4);

    // Verify retreat/advance was called
    const retreatLog = internalCRDT.getRetreatLog();
    const advanceLog = internalCRDT.getAdvanceLog();

    // When processing b1 after a1, we need to retreat a1
    expect(retreatLog).toContain("a1");

    // When processing merge, we need both a1 and b1
    expect(advanceLog.filter((id) => id === "a1").length).toBeGreaterThan(0);
  });

  it("should maintain correct prepare/effect versions during walk", () => {
    const walker = new EgWalker();

    const events: GraphEvent[] = [
      {
        id: "e1",
        parentVersion: new Set(),
        operation: { type: "insert", index: 0, text: "1" },
        timestamp: Date.now(),
      },
      {
        id: "e2",
        parentVersion: new Set(["e1"]),
        operation: { type: "insert", index: 1, text: "2" },
        timestamp: Date.now() + 1,
      },
    ];

    walker.walk(events);

    // After walking, prepare and effect should match
    const prepare = walker.getPrepareVersion();
    const effect = walker.getEffectVersion();

    expect(prepare.equals(effect)).toBe(true);
    expect(effect.has("e1")).toBe(true);
    expect(effect.has("e2")).toBe(true);
  });

  it("should process diamond merge pattern correctly", () => {
    const internalCRDT = new StubInternalCRDT();
    const walker = new EgWalker({ internalCRDT, debug: false });

    // Diamond pattern: base -> (a1, b1) -> merge
    const events: GraphEvent[] = [
      {
        id: "base",
        parentVersion: new Set(),
        operation: { type: "insert", index: 0, text: "X" },
        timestamp: Date.now(),
      },
      {
        id: "a1",
        parentVersion: new Set(["base"]),
        operation: { type: "insert", index: 1, text: "A" },
        timestamp: Date.now() + 1,
      },
      {
        id: "b1",
        parentVersion: new Set(["base"]),
        operation: { type: "insert", index: 1, text: "B" },
        timestamp: Date.now() + 2,
      },
      {
        id: "merge",
        parentVersion: new Set(["a1", "b1"]),
        operation: { type: "insert", index: 2, text: "M" },
        timestamp: Date.now() + 3,
      },
    ];

    const result = walker.walk(events);

    // Verify all events were processed
    expect(result.eventsProcessed).toBe(4);

    // Verify prepare log shows correct order
    const prepareLog = internalCRDT.getPrepareLog();
    expect(prepareLog.map((e) => e.id)).toEqual(["base", "a1", "b1", "merge"]);
  });

  it("should handle complex interleaved DAG", () => {
    const walker = new EgWalker();

    const events: GraphEvent[] = [
      {
        id: "root",
        parentVersion: new Set(),
        operation: { type: "insert", index: 0, text: "R" },
        timestamp: Date.now(),
      },
      {
        id: "a1",
        parentVersion: new Set(["root"]),
        operation: { type: "insert", index: 1, text: "A1" },
        timestamp: Date.now() + 1,
      },
      {
        id: "a2",
        parentVersion: new Set(["a1"]),
        operation: { type: "insert", index: 2, text: "A2" },
        timestamp: Date.now() + 2,
      },
      {
        id: "b1",
        parentVersion: new Set(["root"]),
        operation: { type: "insert", index: 1, text: "B1" },
        timestamp: Date.now() + 3,
      },
      {
        id: "b2",
        parentVersion: new Set(["b1"]),
        operation: { type: "insert", index: 2, text: "B2" },
        timestamp: Date.now() + 4,
      },
      {
        id: "merge1",
        parentVersion: new Set(["a1", "b1"]),
        operation: { type: "insert", index: 3, text: "M1" },
        timestamp: Date.now() + 5,
      },
      {
        id: "merge2",
        parentVersion: new Set(["a2", "b2"]),
        operation: { type: "insert", index: 4, text: "M2" },
        timestamp: Date.now() + 6,
      },
      {
        id: "final",
        parentVersion: new Set(["merge1", "merge2"]),
        operation: { type: "insert", index: 5, text: "F" },
        timestamp: Date.now() + 7,
      },
    ];

    const result = walker.walk(events);

    expect(result.eventsProcessed).toBe(8);
    // Complex DAG will require retreats and advances
    expect(result.retreatCount + result.advanceCount).toBeGreaterThan(0);
  });
});
