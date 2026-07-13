import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { planCriticalReplaySections } from "../../engine/critical-section-replay-plan";
import { planPackedCriticalReplaySections } from "../../engine/packed-critical-replay-plan";
import { ColumnarEventGraphCodec } from "../../graph/columnar-codec";
import { EventGraph } from "../../graph/event-graph";
import type { EventId, GraphEvent, Version } from "../../types";
import { eventDagArb } from "./arbitraries";
import { fcParams } from "./run-config";

describe("property: packed critical replay planning", () => {
  it("matches the general planner for every generated DAG", () => {
    fc.assert(
      fc.property(eventDagArb({}), (events) => {
        const graph = pack(events);

        const compact = planPackedCriticalReplaySections(graph);
        const expected = planCriticalReplaySections(graph);

        expect(compact).not.toBeNull();
        expect(compact!.sectionCount).toBe(expected.length);
        for (
          let sectionIndex = 0;
          sectionIndex < expected.length;
          sectionIndex++
        ) {
          expect(
            compact!.materializeSection(sectionIndex).map(({ id }) => id),
          ).toEqual(expected[sectionIndex]!.events.map(({ id }) => id));
          expect(compact!.isLinearSection(sectionIndex)).toBe(
            isLinear(
              expected[sectionIndex]!.events,
              expected[sectionIndex]!.baseFrontier,
            ),
          );
        }
      }),
      fcParams(),
    );
  });
});

const pack = (events: ReadonlyArray<GraphEvent>): EventGraph => {
  const codec = new ColumnarEventGraphCodec();
  return codec.decodeBinary(codec.encodeBinary(EventGraph.fromEvents(events)));
};

const versionsEqual = (
  left: ReadonlySet<EventId>,
  right: ReadonlySet<EventId>,
): boolean =>
  left.size === right.size && Array.from(left).every((id) => right.has(id));

const isLinear = (
  events: ReadonlyArray<GraphEvent>,
  base: Version,
): boolean => {
  const first = events[0];
  if (first === undefined) return true;
  if (!versionsEqual(first.parentVersion, base)) return false;
  for (let index = 1; index < events.length; index++) {
    const previous = events[index - 1]!;
    const current = events[index]!;
    if (
      current.parentVersion.size !== 1 ||
      !current.parentVersion.has(previous.id)
    ) {
      return false;
    }
  }
  return true;
};
