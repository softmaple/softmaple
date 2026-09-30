/**
 * Property: EventGraph orders its events over insertion ranks exactly like
 * the string-keyed implementations it replaced.
 *
 * Both orders now run over the packed planning view's CSR edges with typed
 * columns, for an object-only graph, a packed graph and a packed prefix with
 * appended events alike. Event IDs are drawn from a tiny alphabet so that
 * ready events tie on span and path length and fall back to comparing IDs
 * with shared prefixes, numeric suffixes and custom forms.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { OPERATION_TYPE } from "../../constants/operation-types";
import { ColumnarEventGraphCodec } from "../../graph/columnar-codec";
import { EventGraph } from "../../graph/event-graph";
import type { EventId, GraphEvent } from "../../types";
import {
  getBranchPreservingTopologicalOrder as referenceBranchPreservingOrder,
  getTopologicalOrder as referenceKahnOrder,
} from "../reference-topological-order";
import { fcParams } from "./run-config";

describe("property: EventGraph topological orders", () => {
  it("should match the reference Kahn order for every graph shape", () => {
    fc.assert(
      fc.property(eventDagArb, fc.nat(), (events, packedSeed) => {
        // Arrange
        const graph = graphWithPackedPrefix(
          events,
          packedSeed % (events.length + 1),
        );

        // Act
        const order = graph.getTopologicalOrder().map(({ id }) => id);

        // Assert
        expect(order).toEqual(referenceKahnOrder(referenceView(events)));
      }),
      fcParams(),
    );
  });

  it("should match the reference branch-preserving order for every graph shape", () => {
    fc.assert(
      fc.property(eventDagArb, fc.nat(), (events, packedSeed) => {
        // Arrange
        const graph = graphWithPackedPrefix(
          events,
          packedSeed % (events.length + 1),
        );

        // Act
        const order = graph
          .getBranchPreservingTopologicalOrder()
          .map(({ id }) => id);

        // Assert
        expect(order).toEqual(
          referenceBranchPreservingOrder(referenceView(events)),
        );
      }),
      fcParams(),
    );
  });
});

// Helpers

const eventIdArb: fc.Arbitrary<EventId> = fc.string({
  minLength: 1,
  unit: fc.constantFrom("a", "b", ":", "0", "1", "9"),
});

/**
 * Events in a valid causal order: every parent is an earlier event, and an
 * event without parent seeds is another root.
 */
const eventDagArb: fc.Arbitrary<ReadonlyArray<GraphEvent>> = fc
  .uniqueArray(fc.tuple(eventIdArb, fc.array(fc.nat())), {
    minLength: 1,
    selector: ([id]) => id,
  })
  .map((entries) =>
    entries.map(([id, parentSeeds], index) => ({
      id,
      parentVersion: new Set(
        index === 0 ? [] : parentSeeds.map((seed) => entries[seed % index]![0]),
      ),
      operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "x" },
      timestamp: index,
    })),
  );

/**
 * Store the first `packedCount` events as a decoded EGW3 prefix and append
 * the rest through `addEvent`: 0 gives an object-only graph and
 * `events.length` a packed-only one.
 */
const graphWithPackedPrefix = (
  events: ReadonlyArray<GraphEvent>,
  packedCount: number,
): EventGraph => {
  if (packedCount === 0) {
    return EventGraph.fromEvents(events);
  }
  const codec = new ColumnarEventGraphCodec();
  const graph = codec.decodeBinary(
    codec.encodeBinary(EventGraph.fromEvents(events.slice(0, packedCount))),
  );
  for (const event of events.slice(packedCount)) {
    graph.addEvent(event);
  }
  return graph;
};

/** The reference traversal input, built from the events alone. */
const referenceView = (events: ReadonlyArray<GraphEvent>) => {
  const children = new Map<EventId, EventId[]>();
  for (const event of events) {
    for (const parent of event.parentVersion) {
      children.set(parent, [...(children.get(parent) ?? []), event.id]);
    }
  }
  const parentCounts = new Map(
    events.map(({ id, parentVersion }) => [id, parentVersion.size]),
  );
  return {
    eventCount: events.length,
    eventIds: events.map(({ id }) => id),
    parentCountOf: (id: EventId): number => parentCounts.get(id) ?? 0,
    childrenOf: (id: EventId): ReadonlyArray<EventId> => children.get(id) ?? [],
  };
};
