/**
 * Integration tests for Section 3.2 — Walking the Event Graph
 * Verify the complete walker flow with retreat/advance
 */

import { describe, it, expect } from "vitest";
import { EgWalker } from "../walker-core/walker";
import type { GraphEvent } from "../graph/event-graph";
import { StubInternalCRDT } from "../walker-crdt/retreat-advance-stubs";

describe("Section 3.2: EgWalker Integration", () => {
  it("should process sequential events without retreat/advance", () => {
    const walker = new EgWalker();

    const events: GraphEvent[] = [
      {
        id: "e1",
        parentVersion: new Set(),
        type: "insert",
        position: 0,
        content: "a",
      },
      {
        id: "e2",
        parentVersion: new Set(["e1"]),
        type: "insert",
        position: 1,
        content: "b",
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
        type: "insert",
        position: 0,
        content: "base",
      },
      {
        id: "a1",
        parentVersion: new Set(["base"]),
        type: "insert",
        position: 1,
        content: "a1",
      },
      {
        id: "b1",
        parentVersion: new Set(["base"]),
        type: "insert",
        position: 1,
        content: "b1",
      },
      {
        id: "merge",
        parentVersion: new Set(["a1", "b1"]),
        type: "insert",
        position: 2,
        content: "merge",
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
        type: "insert",
        position: 0,
        content: "1",
      },
      {
        id: "e2",
        parentVersion: new Set(["e1"]),
        type: "insert",
        position: 1,
        content: "2",
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
        type: "insert",
        position: 0,
        content: "X",
      },
      {
        id: "a1",
        parentVersion: new Set(["base"]),
        type: "insert",
        position: 1,
        content: "A",
      },
      {
        id: "b1",
        parentVersion: new Set(["base"]),
        type: "insert",
        position: 1,
        content: "B",
      },
      {
        id: "merge",
        parentVersion: new Set(["a1", "b1"]),
        type: "insert",
        position: 2,
        content: "M",
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
        type: "insert",
        position: 0,
        content: "R",
      },
      {
        id: "a1",
        parentVersion: new Set(["root"]),
        type: "insert",
        position: 1,
        content: "A1",
      },
      {
        id: "a2",
        parentVersion: new Set(["a1"]),
        type: "insert",
        position: 2,
        content: "A2",
      },
      {
        id: "b1",
        parentVersion: new Set(["root"]),
        type: "insert",
        position: 1,
        content: "B1",
      },
      {
        id: "b2",
        parentVersion: new Set(["b1"]),
        type: "insert",
        position: 2,
        content: "B2",
      },
      {
        id: "merge1",
        parentVersion: new Set(["a1", "b1"]),
        type: "insert",
        position: 3,
        content: "M1",
      },
      {
        id: "merge2",
        parentVersion: new Set(["a2", "b2"]),
        type: "insert",
        position: 4,
        content: "M2",
      },
      {
        id: "final",
        parentVersion: new Set(["merge1", "merge2"]),
        type: "insert",
        position: 5,
        content: "F",
      },
    ];

    const result = walker.walk(events);

    expect(result.eventsProcessed).toBe(8);
    // Complex DAG will require retreats and advances
    expect(result.retreatCount + result.advanceCount).toBeGreaterThan(0);
  });
});
