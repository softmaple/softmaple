/**
 * Tests for Section 3.6: Partial Replay (Efficient Reconstruction)
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  PartialReplayManager,
  computeReplayRange,
  replayEvents,
} from "../core/replay";
import { EventGraph } from "../graph/event-graph";
import { InternalCRDTState } from "../crdt/internal-state";
import { OPERATION_TYPE } from "../constants/operation-types";
import type { GraphEvent } from "../graph/event-graph";
import type { EventId, Version } from "../types";

describe("Section 3.6: Partial Replay", () => {
  let eventGraph: EventGraph;
  let replayManager: PartialReplayManager;
  let state: InternalCRDTState;

  beforeEach(() => {
    eventGraph = new EventGraph();
    replayManager = new PartialReplayManager(eventGraph);
    state = new InternalCRDTState();
  });

  describe("computeReplayRange", () => {
    it("should compute minimal event set between versions", () => {
      // Add events to graph
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

      for (const event of events) {
        eventGraph.addEvent(event);
      }

      // Compute replay from e1 to e3
      const fromVersion: Version = new Set(["e1"]);
      const toVersion: Version = new Set(["e1", "e2", "e3"]);
      const replayRange = replayManager.computeReplayRange(
        fromVersion,
        toVersion,
      );

      // Should only replay e2 and e3
      expect(replayRange).toHaveLength(2);
      expect(replayRange).toContain("e2");
      expect(replayRange).toContain("e3");
      // Should be in topological order
      expect(replayRange.indexOf("e2")).toBeLessThan(replayRange.indexOf("e3"));
    });

    it("should handle empty version ranges", () => {
      const fromVersion: Version = new Set();
      const toVersion: Version = new Set();
      const replayRange = replayManager.computeReplayRange(
        fromVersion,
        toVersion,
      );

      expect(replayRange).toHaveLength(0);
    });

    it("should include dependencies in replay range", () => {
      // Create a diamond dependency: e1 -> e2, e3 -> e4
      const events: GraphEvent[] = [
        {
          id: "e1",
          parentVersion: new Set(),
          operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "1" },
          timestamp: 1,
        },
        {
          id: "e2",
          parentVersion: new Set(["e1"]),
          operation: { type: OPERATION_TYPE.INSERT, index: 1, text: "2" },
          timestamp: 2,
        },
        {
          id: "e3",
          parentVersion: new Set(["e1"]),
          operation: { type: OPERATION_TYPE.INSERT, index: 1, text: "3" },
          timestamp: 3,
        },
        {
          id: "e4",
          parentVersion: new Set(["e2", "e3"]),
          operation: { type: OPERATION_TYPE.INSERT, index: 3, text: "4" },
          timestamp: 4,
        },
      ];

      for (const event of events) {
        eventGraph.addEvent(event);
      }

      // Replay from empty to e4 should include all dependencies
      const fromVersion: Version = new Set();
      const toVersion: Version = new Set(["e4"]);
      const replayRange = replayManager.computeReplayRange(
        fromVersion,
        toVersion,
      );

      // Should include all events in dependency chain
      expect(replayRange).toHaveLength(4);
      expect(replayRange).toEqual(["e1", "e2", "e3", "e4"]);
    });
  });

  describe("replayEvents", () => {
    it("should replay events to reconstruct state", () => {
      // Add events to graph
      const events: GraphEvent[] = [
        {
          id: "e1",
          parentVersion: new Set(),
          operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "Hello" },
          timestamp: 1,
        },
        {
          id: "e2",
          parentVersion: new Set(["e1"]),
          operation: { type: OPERATION_TYPE.INSERT, index: 5, text: " World" },
          timestamp: 2,
        },
      ];

      for (const event of events) {
        eventGraph.addEvent(event);
      }

      // Replay events
      const eventsToReplay = ["e1", "e2"];
      replayManager.replayEvents(eventsToReplay, state);

      // State should be reconstructed
      const stats = state.getStatistics();
      expect(stats.totalRecords).toBeGreaterThan(0);
    });

    it("should skip already replayed events", () => {
      // Add an event
      const event: GraphEvent = {
        id: "e1",
        parentVersion: new Set(),
        operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "Test" },
        timestamp: 1,
      };
      eventGraph.addEvent(event);

      // Replay once
      replayManager.replayEvents(["e1"], state);
      const stats1 = state.getStatistics();

      // Replay again - should skip
      replayManager.replayEvents(["e1"], state);
      const stats2 = state.getStatistics();

      // Stats should be the same (event not applied twice)
      expect(stats2.totalRecords).toEqual(stats1.totalRecords);
    });

    it("should handle missing events gracefully", () => {
      // Try to replay non-existent event
      const eventsToReplay = ["missing"];

      // Should not throw
      expect(() => {
        replayManager.replayEvents(eventsToReplay, state);
      }).not.toThrow();

      // State should be unchanged
      const stats = state.getStatistics();
      expect(stats.totalRecords).toBe(0);
    });
  });

  describe("reconstructPlaceholders", () => {
    it("should reconstruct placeholders for deleted events", () => {
      // Add events including a delete
      const events: GraphEvent[] = [
        {
          id: "e1",
          parentVersion: new Set(),
          operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "Test" },
          timestamp: 1,
        },
        {
          id: "e2",
          parentVersion: new Set(["e1"]),
          operation: { type: OPERATION_TYPE.DELETE, index: 0, length: 4 },
          timestamp: 2,
        },
      ];

      for (const event of events) {
        eventGraph.addEvent(event);
      }

      // Reconstruct placeholders up to e2
      const criticalVersion: Version = new Set(["e1", "e2"]);
      replayManager.reconstructPlaceholders(state, criticalVersion);

      // Should have placeholder for delete
      expect(state.hasPlaceholders()).toBe(true);
      const placeholderIds = state.getPlaceholderIds();
      expect(placeholderIds).toContain("e2");
    });

    it("should only create placeholders for deletes", () => {
      // Add only insert events
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
      ];

      for (const event of events) {
        eventGraph.addEvent(event);
      }

      // Reconstruct placeholders
      const criticalVersion: Version = new Set(["e1", "e2"]);
      replayManager.reconstructPlaceholders(state, criticalVersion);

      // Should have no placeholders (no deletes)
      expect(state.hasPlaceholders()).toBe(false);
    });
  });

  describe("Performance", () => {
    it("should handle O(k log k) complexity for topological sort", () => {
      // Create a chain of 1000 events
      const eventCount = 1000;
      const events: GraphEvent[] = [];

      for (let i = 0; i < eventCount; i++) {
        const event: GraphEvent = {
          id: `e${i}`,
          parentVersion: i === 0 ? new Set() : new Set([`e${i - 1}`]),
          operation: {
            type: OPERATION_TYPE.INSERT,
            index: i,
            text: String(i),
          },
          timestamp: i,
        };
        events.push(event);
        eventGraph.addEvent(event);
      }

      // Measure replay range computation
      const fromVersion: Version = new Set(["e0"]);
      const toVersion: Version = new Set([`e${eventCount - 1}`]);

      const startTime = performance.now();
      const replayRange = replayManager.computeReplayRange(
        fromVersion,
        toVersion,
      );
      const endTime = performance.now();

      // Should complete quickly (< 100ms for 1000 events)
      const duration = endTime - startTime;
      expect(duration).toBeLessThan(100);

      // Should have computed correct range
      expect(replayRange).toHaveLength(eventCount - 1); // All except e0
    });
  });

  describe("Module exports", () => {
    it("should export helper functions", () => {
      // Add a simple event
      const event: GraphEvent = {
        id: "e1",
        parentVersion: new Set(),
        operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "Test" },
        timestamp: 1,
      };
      eventGraph.addEvent(event);

      // Test exported helpers
      const range = computeReplayRange(
        replayManager,
        new Set(),
        new Set(["e1"]),
      );
      expect(range).toEqual(["e1"]);

      // Test replay helper
      replayEvents(replayManager, ["e1"], state);
      expect(state.getStatistics().totalRecords).toBeGreaterThan(0);
    });
  });
});
