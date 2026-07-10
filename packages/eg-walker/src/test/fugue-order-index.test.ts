import { describe, expect, it } from "vitest";

import { OPERATION_TYPE } from "../constants/operation-types";
import { EgWalkerEngine } from "../engine/eg-walker-engine";
import { EventGraph } from "../graph/event-graph";
import type { GraphEvent } from "../types";

const concurrentRoots = (count: number): GraphEvent[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `root:${index}`,
    parentVersion: new Set(),
    operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "x" },
    timestamp: index,
  }));

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
});
