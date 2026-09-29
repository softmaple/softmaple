/**
 * Property: splitting the events after a critical version over insertion
 * ranks finds the same critical sections as the general planner.
 *
 * A critical version's closure is a prefix of every topological order, so the
 * general planner's cuts over its branch-preserving order must reappear as
 * insertion-rank cuts. The insertion-rank planner merges consecutive chains,
 * so the reference sections are merged the same way before comparing.
 *
 * Ordering a section, or the suffix after a cut, by its insertion-rank range
 * gives the same branch-preserving order as ordering the same events by ID.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { OPERATION_TYPE } from "../../constants/operation-types";
import {
  planCriticalReplaySections,
  type CriticalReplaySection,
} from "../../engine/critical-section-replay-plan";
import { ColumnarEventGraphCodec } from "../../graph/columnar-codec";
import {
  EventGraph,
  type InsertionSuffixSection,
} from "../../graph/event-graph";
import type { EventId, GraphEvent, Version } from "../../types";
import { eventDagArb } from "./arbitraries";
import { fcParams } from "./run-config";

describe("property: insertion suffix sections", () => {
  it("should match the general planner after every critical cut of a DAG", () => {
    fc.assert(
      fc.property(eventDagArb({}), fc.boolean(), (events, packed) => {
        // Arrange
        const graph = packed ? pack(events) : EventGraph.fromEvents(events);

        // Act
        const plans = plansAfterEveryCut(graph);

        // Assert
        for (const { actual, expected } of plans) {
          expect(actual).toEqual(expected);
        }
      }),
      fcParams(),
    );
  });

  it("should match the general planner after every critical cut of a fork-and-merge history", () => {
    fc.assert(
      fc.property(
        fc.array(segmentArb, { minLength: 1 }),
        fc.boolean(),
        (segments, packed) => {
          // Arrange
          const events = buildHistory(segments);
          const graph = packed ? pack(events) : EventGraph.fromEvents(events);

          // Act
          const plans = plansAfterEveryCut(graph);

          // Assert
          for (const { actual, expected } of plans) {
            expect(actual).toEqual(expected);
          }
        },
      ),
      fcParams(),
    );
  });

  it("should order every section and every suffix after a cut as the replay order of its events", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          eventDagArb({}),
          fc.array(segmentArb, { minLength: 1 }).map(buildHistory),
        ),
        fc.boolean(),
        (events, packed) => {
          // Arrange
          const graph = packed ? pack(events) : EventGraph.fromEvents(events);

          // Act
          const orders = rangeOrdersAfterEveryCut(graph);

          // Assert
          for (const { actual, expected } of orders) {
            expect(actual).toEqual(expected);
          }
        },
      ),
      fcParams(),
    );
  });
});

// Helpers

type Segment =
  | { readonly kind: "chain"; readonly length: number }
  | {
      readonly kind: "fork";
      readonly branches: ReadonlyArray<number>;
      readonly merged: boolean;
    };

const segmentArb: fc.Arbitrary<Segment> = fc.oneof(
  fc.record({
    kind: fc.constant("chain" as const),
    length: fc.integer({ min: 1, max: 6 }),
  }),
  fc.record({
    kind: fc.constant("fork" as const),
    branches: fc.array(fc.integer({ min: 1, max: 4 }), { minLength: 2 }),
    merged: fc.boolean(),
  }),
);

/**
 * Chains extend every open tip at once; a fork starts one chain per branch
 * from the current tips and either merges them into one event or leaves them
 * open for the next segment.
 */
const buildHistory = (segments: ReadonlyArray<Segment>): GraphEvent[] => {
  const events: GraphEvent[] = [];
  let tips: EventId[] = [];
  const append = (parents: ReadonlyArray<EventId>): EventId => {
    const id = `e${events.length}:0`;
    events.push({
      id,
      operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "x" },
      parentVersion: new Set(parents),
      timestamp: events.length,
    });
    return id;
  };
  for (const segment of segments) {
    if (segment.kind === "chain") {
      for (let index = 0; index < segment.length; index++) {
        tips = [append(tips)];
      }
      continue;
    }
    const branchTips = segment.branches.map((length) => {
      let tip = append(tips);
      for (let index = 1; index < length; index++) {
        tip = append([tip]);
      }
      return tip;
    });
    tips = segment.merged ? [append(branchTips)] : branchTips;
  }
  return events;
};

/** Plan from every cut of the general planner, including the empty prefix. */
const plansAfterEveryCut = (
  graph: EventGraph,
): ReadonlyArray<{
  readonly actual: ReadonlyArray<InsertionSuffixSection>;
  readonly expected: ReadonlyArray<InsertionSuffixSection>;
}> => {
  const sections = planCriticalReplaySections(graph);
  const plans = [];
  let cut = 0;
  for (let first = 0; first <= sections.length; first++) {
    const frontier =
      first === 0 ? new Set<EventId>() : sections[first - 1]!.endFrontier;
    plans.push({
      actual: graph.planInsertionSuffixSections(cut, frontier),
      expected: mergeChains(sections.slice(first), cut),
    });
    cut += sections[first]?.events.length ?? 0;
  }
  return plans;
};

/**
 * Each critical section, and each suffix after a critical cut, ordered as an
 * insertion-rank range and as the replay order of the same events.
 */
const rangeOrdersAfterEveryCut = (
  graph: EventGraph,
): ReadonlyArray<{
  readonly actual: ReadonlyArray<EventId>;
  readonly expected: ReadonlyArray<EventId>;
}> => {
  const eventCount = graph.getEventCount();
  const idAt = (rank: number): EventId =>
    graph.getRankedReplayEventsInRange(rank, rank + 1)[0]!.id;
  const ranges: Array<readonly [number, number]> = [];
  let cut = 0;
  for (const section of planCriticalReplaySections(graph)) {
    ranges.push([cut, cut + section.events.length], [cut, eventCount]);
    cut += section.events.length;
  }
  return ranges.map(([start, end]) => ({
    actual: graph.getRankedReplayEventsInRange(start, end).map(({ id }) => id),
    expected: graph.getRankedReplayOrder(
      new Set(
        Array.from({ length: end - start }, (_unused, index) =>
          idAt(start + index),
        ),
      ),
    ),
  }));
};

const mergeChains = (
  sections: ReadonlyArray<CriticalReplaySection>,
  start: number,
): InsertionSuffixSection[] => {
  const merged: InsertionSuffixSection[] = [];
  let end = start;
  for (const section of sections) {
    const sectionStart = end;
    end += section.events.length;
    const linear = isChain(section.events, section.baseFrontier);
    const previous = merged[merged.length - 1];
    if (linear && previous?.linear) {
      merged[merged.length - 1] = { ...previous, end };
      continue;
    }
    merged.push({
      start: sectionStart,
      end,
      linear,
      baseFrontier: new Set(section.baseFrontier),
    });
  }
  return merged;
};

const isChain = (events: ReadonlyArray<GraphEvent>, base: Version): boolean =>
  events.every((event, index) =>
    index === 0
      ? event.parentVersion.size === base.size &&
        Array.from(base).every((id) => event.parentVersion.has(id))
      : event.parentVersion.size === 1 &&
        event.parentVersion.has(events[index - 1]!.id),
  );

const pack = (events: ReadonlyArray<GraphEvent>): EventGraph => {
  const codec = new ColumnarEventGraphCodec();
  return codec.decodeBinary(codec.encodeBinary(EventGraph.fromEvents(events)));
};
