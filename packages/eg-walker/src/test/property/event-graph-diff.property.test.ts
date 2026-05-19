/**
 * Property: `EventGraph.diffVersions(left, right)` must agree with the
 * set difference of the two expanded causal closures.
 *
 * This gives the graph layer a direct oracle that is independent of the
 * replay engine: the optimized merge-base-style diff is checked against
 * the simpler definition in terms of `expandVersion`.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { EventGraph } from "../../graph/event-graph";
import type { EventId, GraphEvent } from "../../types";
import { cloneEvent } from "../test-helpers";
import { eventDagArb } from "./arbitraries";
import { fcParams } from "./run-config";

describe("property: event graph version diff", () => {
  it("matches expanded causal-set differences", () => {
    fc.assert(
      fc.property(
        eventDagArb({ minSize: 1, maxSize: 16 }),
        fc.array(fc.nat(), { maxLength: 6 }),
        fc.array(fc.nat(), { maxLength: 6 }),
        (events, leftPicks, rightPicks) => {
          const graph = graphFromEvents(events);
          const left = versionFromPicks(events, leftPicks);
          const right = versionFromPicks(events, rightPicks);

          const diff = graph.diffVersions(left, right);
          const expandedLeft = graph.expandVersion(left);
          const expandedRight = graph.expandVersion(right);

          expect(diff.onlyInLeft).toEqual(
            difference(expandedLeft, expandedRight),
          );
          expect(diff.onlyInRight).toEqual(
            difference(expandedRight, expandedLeft),
          );
        },
      ),
      fcParams(),
    );
  });

  it("frontier expansion covers the whole graph", () => {
    fc.assert(
      fc.property(eventDagArb({ minSize: 1, maxSize: 16 }), (events) => {
        const graph = graphFromEvents(events);

        expect(graph.expandVersion(graph.getFrontier()).size).toBe(
          events.length,
        );
      }),
      fcParams(),
    );
  });
});

// Helpers

const graphFromEvents = (events: ReadonlyArray<GraphEvent>): EventGraph => {
  const graph = new EventGraph();
  for (const event of events.map(cloneEvent)) {
    graph.addEvent(event);
  }
  return graph;
};

const versionFromPicks = (
  events: ReadonlyArray<GraphEvent>,
  picks: ReadonlyArray<number>,
): Set<EventId> =>
  new Set(
    picks.map((pick) => {
      const index = pick % events.length;
      return events[index]!.id;
    }),
  );

const difference = <T>(left: ReadonlySet<T>, right: ReadonlySet<T>): Set<T> => {
  const result = new Set<T>();
  for (const item of left) {
    if (!right.has(item)) {
      result.add(item);
    }
  }
  return result;
};
