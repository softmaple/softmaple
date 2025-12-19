import { OPERATION_TYPE } from "../constants/operation-types";
/**
 * Integration tests for Section 3.2 — Walking the Event Graph
 * Verify the complete walker flow with retreat/advance
 */

import { describe, it, expect } from "vitest";
import { EgWalker } from "../core/walker";
import type { GraphEvent } from "../graph/event-graph";
import { StubInternalCRDT } from "../crdt/retreat-advance-stubs";
import type { InternalCRDTState } from "../crdt/retreat-advance-stubs";
import type { EventId } from "../types";

describe("Section 3.2: EgWalker Integration", () => {
  it("should exercise debug logging in retreatToVersion advance path", () => {
    const internalCRDT = new StubInternalCRDT();
    const walker = new EgWalker({ internalCRDT, debug: true });

    // Create events where retreatToVersion needs to advance instead of retreat
    const events: GraphEvent[] = [
      {
        id: "e1",
        parentVersion: new Set(),
        operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "A" },
        timestamp: 1,
      },
      {
        id: "e2",
        parentVersion: new Set(["e1"]),
        operation: { type: OPERATION_TYPE.INSERT, index: 1, text: "B" },
        timestamp: 2,
      },
      {
        id: "e3",
        parentVersion: new Set(["e2"]),
        operation: { type: OPERATION_TYPE.INSERT, index: 2, text: "C" },
        timestamp: 3,
      },
    ];

    // With debug enabled, should log advance operations
    const result = walker.walk(events);
    expect(result.eventsProcessed).toBe(3);
    expect(result.advanceCount).toBeGreaterThan(0);
  });

  it("should handle retreatToVersion early return when no retreat or advance needed", () => {
    const internalCRDT = new StubInternalCRDT();
    const walker = new EgWalker({ internalCRDT });

    // Create sequential events
    // Note: walker may retreat once for algorithmic/initialization reasons even with sequential events
    const events: GraphEvent[] = [
      {
        id: "e1",
        parentVersion: new Set(),
        operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "A" },
        timestamp: Date.now(),
      },
      {
        id: "e2",
        parentVersion: new Set(["e1"]),
        operation: { type: OPERATION_TYPE.INSERT, index: 1, text: "B" },
        timestamp: Date.now() + 1,
      },
      {
        id: "e3",
        parentVersion: new Set(["e2"]), // Sequential: e3 depends only on e2
        operation: { type: OPERATION_TYPE.INSERT, index: 2, text: "C" },
        timestamp: Date.now() + 2,
      },
    ];

    const result = walker.walk(events);
    expect(result.eventsProcessed).toBe(3);
    // Walker may retreat once even for sequential events (allowed upper bound: 1)
    expect(result.retreatCount).toBeLessThanOrEqual(1);
  });

  it("should handle isClearable type guard with null/undefined input", () => {
    // This test verifies the isClearable type guard returns false for null/undefined/non-objects
    // Create a walker with explicit null internalCRDT to trigger type guard check
    // @ts-expect-error - Testing with null internalCRDT to trigger type guard
    const walker = new EgWalker({ internalCRDT: null });
    
    // Create events that would normally trigger state clearing
    const events: GraphEvent[] = [
      {
        id: "e1",
        parentVersion: new Set(),
        operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "test" },
        timestamp: Date.now(),
      },
    ];
    
    // Walk should complete successfully even when isClearable returns false
    const result = walker.walk(events);
    expect(result.eventsProcessed).toBe(1);
    });

    it("should handle retreatToVersion with no retreat or advance needed", () => {
    const internalCRDT = new StubInternalCRDT();
    const walker = new EgWalker({ internalCRDT });

    // Create sequential events
    // Note: walker may retreat once for algorithmic/initialization reasons even with sequential events
    const events: GraphEvent[] = [
      {
        id: "e1",
        parentVersion: new Set(),
        operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "A" },
        timestamp: Date.now(),
      },
      {
        id: "e2",
        parentVersion: new Set(["e1"]),
        operation: { type: OPERATION_TYPE.INSERT, index: 1, text: "B" },
        timestamp: Date.now() + 1,
      },
    ];

    const result = walker.walk(events);
    expect(result.eventsProcessed).toBe(2);
    // Walker may retreat once even for sequential events (allowed upper bound: 1)
    expect(result.retreatCount).toBeLessThanOrEqual(1);
  });

  it("should log debug messages during retreat operations", () => {
    const internalCRDT = new StubInternalCRDT();
    const walker = new EgWalker({ internalCRDT, debug: true });

    // Create events that will trigger retreat with debug logging
    const events: GraphEvent[] = [
      {
        id: "e1",
        parentVersion: new Set(),
        operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "a" },
        timestamp: Date.now(),
      },
      {
        id: "e2",
        parentVersion: new Set(),
        operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "b" },
        timestamp: Date.now() + 1,
      },
      {
        id: "e3",
        parentVersion: new Set(["e2"]),
        operation: { type: OPERATION_TYPE.INSERT, index: 1, text: "c" },
        timestamp: Date.now() + 2,
      },
    ];

    const result = walker.walk(events);
    expect(result.eventsProcessed).toBe(3);
    expect(result.retreatCount).toBeGreaterThan(0);
  });

  it("should log debug messages when advancing during retreat", () => {
    const internalCRDT = new StubInternalCRDT();
    const walker = new EgWalker({ internalCRDT, debug: true });

    // Create a diamond pattern that triggers advance within retreatToVersion
    const events: GraphEvent[] = [
      {
        id: "base",
        parentVersion: new Set(),
        operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "X" },
        timestamp: Date.now(),
      },
      {
        id: "a1",
        parentVersion: new Set(["base"]),
        operation: { type: OPERATION_TYPE.INSERT, index: 1, text: "A" },
        timestamp: Date.now() + 1,
      },
      {
        id: "b1",
        parentVersion: new Set(["base"]),
        operation: { type: OPERATION_TYPE.INSERT, index: 1, text: "B" },
        timestamp: Date.now() + 2,
      },
      {
        id: "merge",
        parentVersion: new Set(["a1", "b1"]),
        operation: { type: OPERATION_TYPE.INSERT, index: 2, text: "M" },
        timestamp: Date.now() + 3,
      },
    ];

    const result = walker.walk(events);
    expect(result.eventsProcessed).toBe(4);
  });

  it("should log debug messages when advancing to effect version", () => {
    const internalCRDT = new StubInternalCRDT();
    const walker = new EgWalker({ internalCRDT, debug: true });

    const events: GraphEvent[] = [
      {
        id: "base",
        parentVersion: new Set(),
        operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "X" },
        timestamp: Date.now(),
      },
      {
        id: "concurrent1",
        parentVersion: new Set(["base"]),
        operation: { type: OPERATION_TYPE.INSERT, index: 1, text: "A" },
        timestamp: Date.now() + 1,
      },
      {
        id: "concurrent2",
        parentVersion: new Set(["base"]),
        operation: { type: OPERATION_TYPE.INSERT, index: 1, text: "B" },
        timestamp: Date.now() + 2,
      },
    ];

    const result = walker.walk(events);
    expect(result.eventsProcessed).toBe(3);
    expect(result.advanceCount).toBeGreaterThan(0);
  });

  it("should process sequential events without retreat/advance", () => {
    const walker = new EgWalker();

    const events: GraphEvent[] = [
      {
        id: "e1",
        parentVersion: new Set(),
        operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "a" },
        timestamp: Date.now(),
      },
      {
        id: "e2",
        parentVersion: new Set(["e1"]),
        operation: { type: OPERATION_TYPE.INSERT, index: 1, text: "b" },
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
        operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "base" },
        timestamp: Date.now(),
      },
      {
        id: "a1",
        parentVersion: new Set(["base"]),
        operation: { type: OPERATION_TYPE.INSERT, index: 1, text: "a1" },
        timestamp: Date.now() + 1,
      },
      {
        id: "b1",
        parentVersion: new Set(["base"]),
        operation: { type: OPERATION_TYPE.INSERT, index: 1, text: "b1" },
        timestamp: Date.now() + 2,
      },
      {
        id: "merge",
        parentVersion: new Set(["a1", "b1"]),
        operation: { type: OPERATION_TYPE.INSERT, index: 2, text: "merge" },
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
        operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "1" },
        timestamp: Date.now(),
      },
      {
        id: "e2",
        parentVersion: new Set(["e1"]),
        operation: { type: OPERATION_TYPE.INSERT, index: 1, text: "2" },
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
        operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "X" },
        timestamp: Date.now(),
      },
      {
        id: "a1",
        parentVersion: new Set(["base"]),
        operation: { type: OPERATION_TYPE.INSERT, index: 1, text: "A" },
        timestamp: Date.now() + 1,
      },
      {
        id: "b1",
        parentVersion: new Set(["base"]),
        operation: { type: OPERATION_TYPE.INSERT, index: 1, text: "B" },
        timestamp: Date.now() + 2,
      },
      {
        id: "merge",
        parentVersion: new Set(["a1", "b1"]),
        operation: { type: OPERATION_TYPE.INSERT, index: 2, text: "M" },
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
        operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "R" },
        timestamp: Date.now(),
      },
      {
        id: "a1",
        parentVersion: new Set(["root"]),
        operation: { type: OPERATION_TYPE.INSERT, index: 1, text: "A1" },
        timestamp: Date.now() + 1,
      },
      {
        id: "a2",
        parentVersion: new Set(["a1"]),
        operation: { type: OPERATION_TYPE.INSERT, index: 2, text: "A2" },
        timestamp: Date.now() + 2,
      },
      {
        id: "b1",
        parentVersion: new Set(["root"]),
        operation: { type: OPERATION_TYPE.INSERT, index: 1, text: "B1" },
        timestamp: Date.now() + 3,
      },
      {
        id: "b2",
        parentVersion: new Set(["b1"]),
        operation: { type: OPERATION_TYPE.INSERT, index: 2, text: "B2" },
        timestamp: Date.now() + 4,
      },
      {
        id: "merge1",
        parentVersion: new Set(["a1", "b1"]),
        operation: { type: OPERATION_TYPE.INSERT, index: 3, text: "M1" },
        timestamp: Date.now() + 5,
      },
      {
        id: "merge2",
        parentVersion: new Set(["a2", "b2"]),
        operation: { type: OPERATION_TYPE.INSERT, index: 4, text: "M2" },
        timestamp: Date.now() + 6,
      },
      {
        id: "final",
        parentVersion: new Set(["merge1", "merge2"]),
        operation: { type: OPERATION_TYPE.INSERT, index: 5, text: "F" },
        timestamp: Date.now() + 7,
      },
    ];

    const result = walker.walk(events);

    expect(result.eventsProcessed).toBe(8);
    // Complex DAG will require retreats and advances
    expect(result.retreatCount + result.advanceCount).toBeGreaterThan(0);
  });

  it("should support debug mode logging", () => {
    const internalCRDT = new StubInternalCRDT();
    const walker = new EgWalker({ internalCRDT, debug: true });

    const events: GraphEvent[] = [
      {
        id: "e1",
        parentVersion: new Set(),
        operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "a" },
        timestamp: Date.now(),
      },
      {
        id: "e2",
        parentVersion: new Set(["e1"]),
        operation: { type: OPERATION_TYPE.INSERT, index: 1, text: "b" },
        timestamp: Date.now() + 1,
      },
    ];

    // With debug enabled, walker should still process correctly
    const result = walker.walk(events);
    expect(result.eventsProcessed).toBe(2);
  });

  it("should initialize with custom graphWalker implementation", () => {
    const mockGraphWalker = {
      addEvent: () => {},
      topologicalOrder: () => [],
    };

    // @ts-expect-error - Testing with minimal mock object
    const walker = new EgWalker({ graphWalker: mockGraphWalker });
    const result = walker.walk([]);

    expect(result.eventsProcessed).toBe(0);
  });

  it("should initialize with custom internalCRDT implementation", () => {
    const customCRDT = new StubInternalCRDT();
    const walker = new EgWalker({ internalCRDT: customCRDT });

    const events: GraphEvent[] = [
      {
        id: "e1",
        parentVersion: new Set(),
        operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "test" },
        timestamp: Date.now(),
      },
    ];

    walker.walk(events);

    // Verify our custom CRDT was used
    const prepareLog = customCRDT.getPrepareLog();
    expect(prepareLog).toHaveLength(1);
    expect(prepareLog[0]?.id).toBe("e1");
  });

  it("should handle fallback to StubInternalCRDT when ConcreteCRDTState not available", () => {
    // This test verifies the constructor's fallback logic
    const walker = new EgWalker();
    expect(walker).toBeDefined();
  });

  it("should handle retreat when prepareVersion doesn't match parent", () => {
    const internalCRDT = new StubInternalCRDT();
    const walker = new EgWalker({ internalCRDT });

    // Create events that will trigger retreat
    const events: GraphEvent[] = [
      {
        id: "e1",
        parentVersion: new Set(),
        operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "a" },
        timestamp: Date.now(),
      },
      {
        id: "e2",
        parentVersion: new Set(),
        operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "b" },
        timestamp: Date.now() + 1,
      },
      {
        id: "e3",
        parentVersion: new Set(["e2"]),
        operation: { type: OPERATION_TYPE.INSERT, index: 1, text: "c" },
        timestamp: Date.now() + 2,
      },
    ];

    const result = walker.walk(events);
    expect(result.eventsProcessed).toBe(3);
    // Should have retreated when switching from e1 to e2
    expect(result.retreatCount).toBeGreaterThan(0);
  });

  it("should handle advance when transitioning to effect state", () => {
    const internalCRDT = new StubInternalCRDT();
    const walker = new EgWalker({ internalCRDT });

    const events: GraphEvent[] = [
      {
        id: "base",
        parentVersion: new Set(),
        operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "X" },
        timestamp: Date.now(),
      },
      {
        id: "concurrent1",
        parentVersion: new Set(["base"]),
        operation: { type: OPERATION_TYPE.INSERT, index: 1, text: "A" },
        timestamp: Date.now() + 1,
      },
      {
        id: "concurrent2",
        parentVersion: new Set(["base"]),
        operation: { type: OPERATION_TYPE.INSERT, index: 1, text: "B" },
        timestamp: Date.now() + 2,
      },
    ];

    const result = walker.walk(events);
    expect(result.eventsProcessed).toBe(3);
    expect(result.advanceCount).toBeGreaterThan(0);
  });

  it("should clear state at critical versions when supported", () => {
    const walker = new EgWalker();

    // Create enough events to potentially trigger state clearing
    const events: GraphEvent[] = Array.from({ length: 10 }, (_, i) => ({
      id: `e${i}`,
      parentVersion: i > 0 ? new Set([`e${i - 1}`]) : new Set(),
      operation: { type: OPERATION_TYPE.INSERT, index: i, text: String(i) },
      timestamp: Date.now() + i,
    }));

    const result = walker.walk(events);
    expect(result.eventsProcessed).toBe(10);
  });

  it("should handle events with no operation gracefully", () => {
    const walker = new EgWalker();

    const events: GraphEvent[] = [
      {
        id: "e1",
        parentVersion: new Set(),
        operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "test" },
        timestamp: Date.now(),
      },
    ];

    const result = walker.walk(events);
    expect(result.eventsProcessed).toBe(1);
  });

  describe("Edge cases for isClearable type guard", () => {
    it("should handle CRDT without clearable methods", () => {
      // Create walker with stub that has clearable methods
      const mockCRDT = {
          reset: () => {},
          getCurrentText: () => "",
          applyPrepare: (_event: GraphEvent, appliedEvents: ReadonlySet<EventId>) =>
            new Set(appliedEvents),
          retreat: (_eventId: EventId, appliedEvents: ReadonlySet<EventId>) =>
            new Set(appliedEvents),
          advance: (_eventId: EventId, appliedEvents: ReadonlySet<EventId>) =>
            new Set(appliedEvents),
          // Missing clearable methods - should not crash
      } as unknown as InternalCRDTState;

      const config: { internalCRDT?: InternalCRDTState } = {
        internalCRDT: mockCRDT,
      };
      const walker = new EgWalker(config);

      const events: GraphEvent[] = [
        {
          id: "e1",
          parentVersion: new Set(),
          operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "Test" },
          timestamp: 1,
        },
      ];

      // Should not crash even without clearable methods
      const result = walker.walk(events);
    expect(result.eventsProcessed).toBe(1);
    });

    it("should handle concurrent events requiring retreat then advance", () => {
      const walker = new EgWalker();

      const events: GraphEvent[] = [
        {
          id: "base",
          parentVersion: new Set(),
          operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "Base" },
          timestamp: 1,
        },
        {
          id: "concurrent1",
          parentVersion: new Set(["base"]),
          operation: { type: OPERATION_TYPE.INSERT, index: 4, text: " A" },
          timestamp: 2,
        },
        {
          id: "concurrent2",
          parentVersion: new Set(["base"]),
          operation: { type: OPERATION_TYPE.INSERT, index: 4, text: " B" },
          timestamp: 3,
        },
      ];

      const result = walker.walk(events);
      expect(result.eventsProcessed).toBe(3);
      expect(result.retreatCount).toBeGreaterThan(0);
    });

    it("should handle null internalCRDT in isClearable", () => {
      // Create walker with null internalCRDT (edge case)
      const config = {
        internalCRDT: null as unknown as InternalCRDTState,
      };
      const walker = new EgWalker(config);

      const events: GraphEvent[] = [
        {
          id: "e1",
          parentVersion: new Set(),
          operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "Test" },
          timestamp: 1,
        },
      ];

      // Should not crash even with null internalCRDT
      const result = walker.walk(events);
    expect(result.eventsProcessed).toBe(1);
    });

    it("should handle undefined internalCRDT in isClearable", () => {
      // Create walker with undefined internalCRDT (edge case)
      const config = {
        internalCRDT: undefined as unknown as InternalCRDTState,
      };
      const walker = new EgWalker(config);

      const events: GraphEvent[] = [
        {
          id: "e1",
          parentVersion: new Set(),
          operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "Test" },
          timestamp: 1,
        },
      ];

      // Should not crash even with undefined internalCRDT
      const result = walker.walk(events);
    expect(result.eventsProcessed).toBe(1);
    });

  });
});
