import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { OPERATION_TYPE } from "../constants/operation-types";
import { EgWalkerEngine } from "../engine/eg-walker-engine";
import {
  DEFAULT_INTEGRATION_SCAN_BUDGET,
  type EngineStats,
  type IntegrationScanBudget,
} from "../engine/internals/engine-types";
import { EventGraph } from "../graph/event-graph";
import type { GraphEvent } from "../types";
import { traceParamsArb } from "./property/arbitraries";
import { fcParams } from "./property/run-config";
import { runTrace } from "./property/trace-runner";

const concurrentRoots = (count: number): GraphEvent[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `root:${index}`,
    parentVersion: new Set(),
    operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "x" },
    timestamp: index,
  }));

const concurrentAfterBase = (count: number): GraphEvent[] => [
  {
    id: "base:0",
    parentVersion: new Set(),
    operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "b" },
    timestamp: 0,
  },
  ...Array.from({ length: count }, (_, index) => ({
    id: `child:${index}`,
    parentVersion: new Set(["base:0"]),
    operation: { type: OPERATION_TYPE.INSERT, index: 1, text: "x" },
    timestamp: index + 1,
  })),
];

const concurrentBeforeBase = (count: number): GraphEvent[] => [
  {
    id: "base:0",
    parentVersion: new Set(),
    operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "b" },
    timestamp: 0,
  },
  ...Array.from({ length: count }, (_, index) => ({
    id: `child:${index}`,
    parentVersion: new Set(["base:0"]),
    operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "x" },
    timestamp: index + 1,
  })),
];

const splitInitialPlaceholder = (count: number): GraphEvent[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `placeholder-split:${index}`,
    parentVersion: new Set(),
    operation: {
      type: OPERATION_TYPE.INSERT,
      index: index + 1,
      text: "x",
    },
    timestamp: index,
  }));

const descendingConcurrentRoots = (count: number): GraphEvent[] =>
  concurrentRoots(count).map((event, index) => ({
    ...event,
    id: `root:${count - 1 - index}`,
  }));

const prepends = (count: number): GraphEvent[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `author:${index}`,
    parentVersion: new Set(index === 0 ? [] : [`author:${index - 1}`]),
    operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "p" },
    timestamp: index,
  }));

const samePositionBursts = [
  { shape: "root siblings", build: concurrentRoots },
  { shape: "right siblings of one record", build: concurrentAfterBase },
  { shape: "left siblings of one record", build: concurrentBeforeBase },
] as const;

const splitTypedRunWithRootFork = (count: number): GraphEvent[] => [
  ...Array.from({ length: count }, (_, index) => ({
    id: `author:${index}`,
    parentVersion: new Set(index === 0 ? [] : [`author:${index - 1}`]),
    operation: {
      type: OPERATION_TYPE.INSERT,
      index,
      text: "a",
    },
    timestamp: index,
  })),
  {
    id: "fork:0",
    parentVersion: new Set(),
    operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "b" },
    timestamp: count,
  },
];

describe("FugueOrderIndex structural bounds", () => {
  it("integrates concurrent root siblings without linear conflict probes", () => {
    const events = concurrentRoots(1_600);
    const graph = EventGraph.fromEvents(events);

    const generated = new EgWalkerEngine().generate(events, "", {
      eventGraph: graph,
      eventOrder: events,
      integrationMode: "indexed",
    });

    expect(generated.text).toHaveLength(events.length);
    expect(generated.stats.integrationProbeCount).toBe(0);
    expect(generated.stats.fugueMarkerOperations).toBe(events.length * 3);
    expect(generated.stats.fugueComparisons).toBeLessThan(
      events.length * Math.ceil(Math.log2(events.length)) * 8,
    );
  });

  it("integrates siblings sharing a non-root anchor without linear probes", () => {
    const events = concurrentAfterBase(1_600);
    const graph = EventGraph.fromEvents(events);

    const generated = new EgWalkerEngine().generate(events, "", {
      eventGraph: graph,
      eventOrder: events,
      integrationMode: "indexed",
    });

    expect(generated.text).toHaveLength(events.length);
    expect(generated.stats.integrationProbeCount).toBe(0);
    expect(generated.stats.fugueMarkerOperations).toBe(events.length * 3);
    expect(generated.stats.fugueComparisons).toBeLessThan(
      events.length * Math.ceil(Math.log2(events.length)) * 8,
    );
  });

  it("indexes left siblings with a shared right anchor", () => {
    const events = concurrentBeforeBase(1_600);
    const graph = EventGraph.fromEvents(events);

    const generated = new EgWalkerEngine().generate(events, "", {
      eventGraph: graph,
      eventOrder: events,
      integrationMode: "indexed",
    });

    expect(generated.text).toHaveLength(events.length);
    expect(generated.stats.integrationProbeCount).toBe(0);
    expect(generated.stats.fugueMarkerOperations).toBe(events.length * 3);
    expect(generated.stats.fugueComparisons).toBeLessThan(
      events.length * Math.ceil(Math.log2(events.length)) * 8,
    );
  });

  it("scales structural work as O(n log n) across 400/800/1,600", () => {
    const sizes = [400, 800, 1_600] as const;
    const measurements = sizes.map((size) => {
      const events = concurrentRoots(size);
      const graph = EventGraph.fromEvents(events);
      const stats = new EgWalkerEngine().generate(events, "", {
        eventGraph: graph,
        eventOrder: events,
        integrationMode: "indexed",
      }).stats;
      return {
        size,
        work:
          stats.fugueComparisons +
          stats.fugueMarkerOperations +
          stats.fugueRotations +
          stats.sequenceTreeOperations,
      };
    });

    for (const measurement of measurements) {
      expect(measurement.work).toBeLessThan(
        measurement.size * Math.ceil(Math.log2(measurement.size)) * 80,
      );
    }
    expect(measurements[1]!.work / measurements[0]!.work).toBeLessThan(2.75);
    expect(measurements[2]!.work / measurements[1]!.work).toBeLessThan(2.75);
  });

  it("keeps logarithmic bounds for IDs that degenerated the legacy treap", () => {
    // Arrange
    const events = adversarialConcurrentRoots(400);
    const graph = EventGraph.fromEvents(events);
    const indexedEngine = new EgWalkerEngine();
    const oracleEngine = new EgWalkerEngine();

    // Act
    const indexed = indexedEngine.generate(events, "", {
      eventGraph: graph,
      eventOrder: events,
      integrationMode: "indexed",
    });
    const oracle = oracleEngine.generate(events, "", {
      eventGraph: graph,
      eventOrder: events,
      integrationMode: "linear-oracle",
    });

    // Assert
    expect(indexed.text).toBe(oracle.text);
    expect(indexedEngine.getSequenceRecords()).toEqual(
      oracleEngine.getSequenceRecords(),
    );
    expect(indexed.stats.integrationProbeCount).toBe(0);
    expect(indexed.stats.fugueRotations).toBeGreaterThan(0);
    expect(indexed.stats.fugueComparisons).toBeLessThan(
      events.length * Math.ceil(Math.log2(events.length)) * 2,
    );
  });

  it("updates repeated placeholder splits without rebuilding", () => {
    // Arrange
    const count = 64;
    const events = splitInitialPlaceholder(count);
    const graph = EventGraph.fromEvents(events);
    const initialText = "a".repeat(count + 1);
    const indexedEngine = new EgWalkerEngine();
    const oracleEngine = new EgWalkerEngine();

    // Act
    const indexed = indexedEngine.generate(events, initialText, {
      eventGraph: graph,
      eventOrder: events,
      integrationMode: "indexed",
    });
    const oracle = oracleEngine.generate(events, initialText, {
      eventGraph: graph,
      eventOrder: events,
      integrationMode: "linear-oracle",
    });

    // Assert
    expect(indexed.text).toBe(oracle.text);
    expect(indexed.transformedOperations).toEqual(oracle.transformedOperations);
    expect(indexedEngine.getSequenceRecords()).toEqual(
      oracleEngine.getSequenceRecords(),
    );
    expect(indexed.stats.fugueRebuilds).toBe(0);
    expect(indexed.stats.fugueMarkerOperations).toBe(6 * count + 3);
  });

  it("updates typed-run isolation splits without rebuilding", () => {
    // Arrange
    const count = 64;
    const events = splitTypedRunWithRootFork(count);
    const graph = EventGraph.fromEvents(events);
    const indexedEngine = new EgWalkerEngine();
    const oracleEngine = new EgWalkerEngine();

    // Act
    const indexed = indexedEngine.generate(events, "", {
      eventGraph: graph,
      eventOrder: events,
      integrationMode: "indexed",
    });
    const oracle = oracleEngine.generate(events, "", {
      eventGraph: graph,
      eventOrder: events,
      integrationMode: "linear-oracle",
    });

    // Assert
    expect(indexed.text).toBe(oracle.text);
    expect(indexed.transformedOperations).toEqual(oracle.transformedOperations);
    expect(indexedEngine.getSequenceRecords()).toEqual(
      oracleEngine.getSequenceRecords(),
    );
    expect(indexedEngine.getDeleteTargetRecords()).toEqual(
      oracleEngine.getDeleteTargetRecords(),
    );
    expect(indexed.stats.fugueRebuilds).toBe(0);
    // The object prepare transition isolates the whole canonical span at its
    // boundaries, so marker maintenance stays constant as the run grows.
    expect(indexed.stats.fugueMarkerOperations).toBeLessThanOrEqual(6);
  });

  it("matches generated compound traces without conflict scans", () => {
    fc.assert(
      fc.property(
        traceParamsArb({
          minReplicas: 2,
          maxReplicas: 3,
          minStepsPerReplica: 2,
          maxStepsPerReplica: 6,
        }),
        (params) => {
          const trace = runTrace(params);
          const graph = EventGraph.fromEvents(trace.events);
          const order = graph.getBranchPreservingTopologicalOrder();
          const indexedEngine = new EgWalkerEngine();
          const generated = indexedEngine.generate(order, params.initialText, {
            eventGraph: graph,
            eventOrder: order,
            integrationMode: "indexed",
          });
          const oracleEngine = new EgWalkerEngine();
          const oracle = oracleEngine.generate(order, params.initialText, {
            eventGraph: graph,
            eventOrder: order,
            integrationMode: "linear-oracle",
          });

          expect(generated.text).toBe(trace.canonicalText);
          expect(generated.text).toBe(oracle.text);
          expect(generated.transformedOperations).toEqual(
            oracle.transformedOperations,
          );
          expect(indexedEngine.getSequenceRecords()).toEqual(
            oracleEngine.getSequenceRecords(),
          );
          expect(indexedEngine.getDeleteTargetRecords()).toEqual(
            oracleEngine.getDeleteTargetRecords(),
          );
          expect(generated.stats.integrationProbeCount).toBe(0);
          expect(generated.stats.fugueRebuilds).toBe(0);
        },
      ),
      fcParams(),
    );
  });
});

describe("adaptive conflict integration", () => {
  it("never builds the index while every insert lands at a known position", () => {
    // Arrange
    const events = prepends(400);
    const graph = EventGraph.fromEvents(events);

    // Act
    const adaptive = new EgWalkerEngine().generate(events, "", {
      eventGraph: graph,
      eventOrder: events,
    });
    const indexed = new EgWalkerEngine().generate(events, "", {
      eventGraph: graph,
      eventOrder: events,
      integrationMode: "indexed",
    });

    // Assert
    expect(adaptive.text).toBe(indexed.text);
    expect(adaptive.stats.sequenceRecordCount).toBe(events.length);
    expect(adaptive.stats.integrationProbeCount).toBe(0);
    expect(adaptive.stats.fugueRebuilds).toBe(0);
    expect(adaptive.stats.fugueMarkerOperations).toBe(0);
    expect(indexed.stats.fugueMarkerOperations).toBe(events.length * 3);
  });

  it("places conflicts that stop at the first record without the index", () => {
    // Arrange: every insert sorts before its earlier siblings.
    const events = descendingConcurrentRoots(1_600);
    const graph = EventGraph.fromEvents(events);
    const adaptiveEngine = new EgWalkerEngine();
    const indexedEngine = new EgWalkerEngine();

    // Act
    const adaptive = adaptiveEngine.generate(events, "", {
      eventGraph: graph,
      eventOrder: events,
    });
    indexedEngine.generate(events, "", {
      eventGraph: graph,
      eventOrder: events,
      integrationMode: "indexed",
    });

    // Assert
    expect(adaptiveEngine.getSequenceRecords()).toEqual(
      indexedEngine.getSequenceRecords(),
    );
    expect(adaptive.stats.integrationProbeCount).toBe(events.length - 1);
    expect(adaptive.stats.fugueRebuilds).toBe(0);
    expect(adaptive.stats.fugueMarkerOperations).toBe(0);
  });

  for (const { shape, build } of samePositionBursts) {
    it(`builds the index once for a same-position burst of ${shape}`, () => {
      // Arrange: every insert sorts after its earlier siblings, so an
      // unbounded scan would cross all of them.
      const events = build(1_600);
      const graph = EventGraph.fromEvents(events);
      const adaptiveEngine = new EgWalkerEngine();
      const indexedEngine = new EgWalkerEngine();

      // Act
      const adaptive = adaptiveEngine.generate(events, "", {
        eventGraph: graph,
        eventOrder: events,
      });
      const indexed = indexedEngine.generate(events, "", {
        eventGraph: graph,
        eventOrder: events,
        integrationMode: "indexed",
      });

      // Assert
      expect(adaptive.text).toBe(indexed.text);
      expect(adaptiveEngine.getSequenceRecords()).toEqual(
        indexedEngine.getSequenceRecords(),
      );
      expect(adaptive.stats.fugueRebuilds).toBe(1);
      expectWithinScanBudget(adaptive.stats, DEFAULT_INTEGRATION_SCAN_BUDGET);
      // The build and the later inserts index every record exactly once.
      expect(adaptive.stats.fugueMarkerOperations).toBe(
        adaptive.stats.sequenceRecordCount * 3,
      );
      expect(adaptive.stats.fugueComparisons).toBeLessThan(
        events.length * Math.ceil(Math.log2(events.length)) * 8,
      );
    });

    it(`scales a same-position burst of ${shape} as O(n log n)`, () => {
      const sizes = [400, 800, 1_600] as const;
      const measurements = sizes.map((size) => {
        const events = build(size);
        const graph = EventGraph.fromEvents(events);
        const stats = new EgWalkerEngine().generate(events, "", {
          eventGraph: graph,
          eventOrder: events,
        }).stats;
        return {
          size,
          work:
            stats.integrationProbeCount +
            stats.fugueComparisons +
            stats.fugueMarkerOperations +
            stats.fugueRotations +
            stats.sequenceTreeOperations,
        };
      });

      for (const measurement of measurements) {
        expect(measurement.work).toBeLessThan(
          measurement.size * Math.ceil(Math.log2(measurement.size)) * 80,
        );
      }
      expect(measurements[1]!.work / measurements[0]!.work).toBeLessThan(2.75);
      expect(measurements[2]!.work / measurements[1]!.work).toBeLessThan(2.75);
    });
  }

  it("builds a restored engine's index only once a conflict needs it", () => {
    // Arrange
    const events = concurrentRoots(64);
    const graph = EventGraph.fromEvents(events);
    const live = new EgWalkerEngine();
    live.generate(events, "", { eventGraph: graph, eventOrder: events });
    const restored = EgWalkerEngine.fromSnapshotState({
      graph,
      currentVersion: live.getCurrentVersion(),
      text: live.getText(),
      sequenceRecords: live.getSequenceRecords(),
      deleteTargets: live.getDeleteTargetRecords(),
    });
    expect(restored.getStats().fugueRebuilds).toBe(0);

    // Act: more roots that sort after every earlier one.
    for (const event of concurrentRoots(256).slice(64)) {
      graph.addEvent(event);
      const expected = live.applyEvent(event, graph);
      const actual = restored.applyEvent(event, graph);

      // Assert
      expect(actual.text).toBe(expected.text);
      expect(actual.transformedOperations).toEqual(
        expected.transformedOperations,
      );
    }
    expect(restored.getSequenceRecords()).toEqual(live.getSequenceRecords());
    expect(restored.getStats().fugueRebuilds).toBe(1);
  });

  it("matches the linear oracle for any scan budget", () => {
    fc.assert(
      fc.property(
        traceParamsArb({
          minReplicas: 2,
          maxReplicas: 4,
          minStepsPerReplica: 2,
          maxStepsPerReplica: 8,
        }),
        fc.constantFrom<IntegrationScanBudget>(
          { initial: 0, perRecord: 0 },
          { initial: 1, perRecord: 0 },
          { initial: 3, perRecord: 0 },
          { initial: 0, perRecord: 1 },
          DEFAULT_INTEGRATION_SCAN_BUDGET,
        ),
        (params, budget) => {
          const trace = runTrace(params);
          const graph = EventGraph.fromEvents(trace.events);
          const order = graph.getBranchPreservingTopologicalOrder();
          const adaptiveEngine = new EgWalkerEngine();
          const adaptive = adaptiveEngine.generate(order, params.initialText, {
            eventGraph: graph,
            eventOrder: order,
            integrationScanBudget: budget,
          });
          const oracleEngine = new EgWalkerEngine();
          const oracle = oracleEngine.generate(order, params.initialText, {
            eventGraph: graph,
            eventOrder: order,
            integrationMode: "linear-oracle",
          });
          const cold = new EgWalkerEngine().generate(
            order,
            params.initialText,
            {
              eventGraph: graph,
              eventOrder: order,
              integrationScanBudget: budget,
              collectTransformedOperations: false,
            },
          );

          expect(adaptive.text).toBe(trace.canonicalText);
          expect(adaptive.text).toBe(oracle.text);
          expect(cold.text).toBe(oracle.text);
          expect(adaptive.transformedOperations).toEqual(
            oracle.transformedOperations,
          );
          expect(adaptiveEngine.getSequenceRecords()).toEqual(
            oracleEngine.getSequenceRecords(),
          );
          expect(adaptiveEngine.getDeleteTargetRecords()).toEqual(
            oracleEngine.getDeleteTargetRecords(),
          );
          expectWithinScanBudget(adaptive.stats, budget);
          expectWithinScanBudget(cold.stats, budget);
        },
      ),
      fcParams(),
    );
  });
});

// Helpers

/**
 * Scans never spend more than the budget the final record count allows, and
 * an index that was never built never touched a marker.
 */
const expectWithinScanBudget = (
  stats: EngineStats,
  budget: IntegrationScanBudget,
): void => {
  expect(stats.integrationProbeCount).toBeLessThanOrEqual(
    budget.initial + budget.perRecord * stats.sequenceRecordCount,
  );
  expect(stats.fugueRebuilds).toBeLessThanOrEqual(1);
  if (stats.fugueRebuilds === 0) {
    expect(stats.fugueMarkerOperations).toBe(0);
  }
};

const adversarialConcurrentRoots = (count: number): GraphEvent[] => {
  const candidateCount = 65_536;
  const priorities = new Uint32Array(candidateCount);
  const tails = new Int32Array(candidateCount);
  const previous = new Int32Array(candidateCount);
  previous.fill(-1);
  let longestLength = 0;

  for (let index = 0; index < candidateCount; index++) {
    const priority = legacySiblingPriority(`root:${index}`);
    priorities[index] = priority;
    let low = 0;
    let high = longestLength;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (priorities[tails[middle]!]! > priority) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }
    if (low > 0) {
      previous[index] = tails[low - 1]!;
    }
    tails[low] = index;
    if (low === longestLength) {
      longestLength++;
    }
  }

  const sequenceNumbers: number[] = [];
  let cursor = tails[longestLength - 1] ?? -1;
  while (cursor >= 0) {
    sequenceNumbers.push(cursor);
    cursor = previous[cursor] ?? -1;
  }
  sequenceNumbers.reverse();
  if (sequenceNumbers.length < count) {
    throw new Error(
      `Only found ${sequenceNumbers.length} adversarial IDs; expected ${count}`,
    );
  }

  return sequenceNumbers.slice(0, count).map((sequence) => ({
    id: `root:${sequence}`,
    parentVersion: new Set(),
    operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "x" },
    timestamp: sequence,
  }));
};

const legacySiblingPriority = (eventId: string): number => {
  const value = `${eventId}:0:sibling`;
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
};
