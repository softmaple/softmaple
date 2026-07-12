import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { OPERATION_TYPE } from "../constants/operation-types";
import { EgWalkerEngine } from "../engine/eg-walker-engine";
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
    expect(indexed.stats.fugueMarkerOperations).toBe(3 * count + 3);
  });

  it("matches generated compound traces without production conflict scans", () => {
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

// Helpers

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
