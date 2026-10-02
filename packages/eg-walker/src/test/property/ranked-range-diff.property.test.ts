/**
 * Property: the chain-walking range diff a replay engine uses for its
 * prepare-view transitions returns exactly the transition of the per-event
 * ranked diff, in the same order, on graphs with long causal chains, with
 * and without a packed prefix.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { OPERATION_TYPE } from "../../constants/operation-types";
import { ColumnarEventGraphCodec } from "../../graph/columnar-codec";
import { EventGraph } from "../../graph/event-graph";
import type { GraphEvent } from "../../types";
import { fcParams } from "./run-config";

describe("property: ranked range diff", () => {
  it("expands to the per-event transition", () => {
    fc.assert(
      fc.property(
        chainyDagArb,
        fc.nat(),
        fc.array(fc.nat(), { minLength: 1, maxLength: 3 }),
        fc.array(fc.nat(), { minLength: 1, maxLength: 3 }),
        (events, packedPick, leftPicks, rightPicks) => {
          const graph = graphWithPackedPrefix(
            events,
            packedPick % (events.length + 1),
          );
          const count = graph.getEventCount();
          const left = uniqueLocalVersions(leftPicks, count);
          const right = uniqueLocalVersions(rightPicks, count);

          const expected = graph.getLocalVersionTransition(left, right);
          const ranges = graph.getLocalVersionRangeTransition(left, right);

          expect(expandRanges(ranges)).toEqual(expected);
          expect(ranges.retreatEventCount).toBe(expected.retreat.length);
          expect(ranges.advanceEventCount).toBe(expected.advance.length);
        },
      ),
      fcParams(),
    );
  });
});

// Helpers

/**
 * DAGs where most events extend the previous one, so diffs walk long
 * chains, with branches and merges between them.
 */
const chainyDagArb: fc.Arbitrary<ReadonlyArray<GraphEvent>> = fc
  .array(
    fc.oneof(
      { weight: 6, arbitrary: fc.constant<ReadonlyArray<number>>([]) },
      {
        weight: 2,
        arbitrary: fc.array(fc.nat(), { minLength: 1, maxLength: 2 }),
      },
    ),
    { minLength: 1, maxLength: 40 },
  )
  .map((parentSeeds) =>
    parentSeeds.map((seeds, index): GraphEvent => {
      const parents =
        index === 0
          ? []
          : seeds.length === 0
            ? [index - 1]
            : [...new Set(seeds.map((seed) => seed % index))];
      return {
        id: `a${index % 3}:${index}`,
        parentVersion: new Set(
          parents.map((parent) => `a${parent % 3}:${parent}`),
        ),
        operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "x" },
        timestamp: index,
      };
    }),
  );

/** Pack the first `packedCount` events, then append the rest as a tail. */
const graphWithPackedPrefix = (
  events: ReadonlyArray<GraphEvent>,
  packedCount: number,
): EventGraph => {
  const codec = new ColumnarEventGraphCodec();
  const graph =
    packedCount === 0
      ? new EventGraph()
      : codec.decodeBinary(
          codec.encodeBinary(
            EventGraph.fromEvents(events.slice(0, packedCount)),
          ),
        );
  for (const event of events.slice(packedCount)) {
    graph.addEvent(event);
  }
  return graph;
};

const uniqueLocalVersions = (
  picks: ReadonlyArray<number>,
  count: number,
): number[] => [...new Set(picks.map((pick) => pick % count))];

const expandRanges = (
  ranges: ReturnType<EventGraph["getLocalVersionRangeTransition"]>,
): { retreat: number[]; advance: number[] } => {
  const retreat: number[] = [];
  for (let range = 0; range < ranges.retreatRangeCount; range++) {
    for (
      let localVersion = ranges.retreatEnds[range]! - 1;
      localVersion >= ranges.retreatStarts[range]!;
      localVersion--
    ) {
      retreat.push(localVersion);
    }
  }
  const advance: number[] = [];
  for (let range = 0; range < ranges.advanceRangeCount; range++) {
    for (
      let localVersion = ranges.advanceStarts[range]!;
      localVersion < ranges.advanceEnds[range]!;
      localVersion++
    ) {
      advance.push(localVersion);
    }
  }
  return { retreat, advance };
};
