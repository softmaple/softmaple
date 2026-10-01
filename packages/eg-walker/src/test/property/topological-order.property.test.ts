/**
 * Property: EventGraph orders its events over insertion ranks exactly like
 * the string-keyed implementations it replaced.
 *
 * Both orders now run over the packed planning view's runs with typed
 * columns, for an object-only graph, a packed graph and a packed prefix with
 * appended events alike. Event IDs are drawn from a tiny alphabet so that
 * ready events tie on span and path length and fall back to comparing IDs
 * with shared prefixes, numeric suffixes and custom forms.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { OPERATION_TYPE } from "../../constants/operation-types";
import { ColumnarEventGraphCodec } from "../../graph/columnar-codec";
import { encodeTopologicallyOrderedEventsBinary } from "../../graph/columnar-codec/topological-binary-encoder";
import { EventGraph } from "../../graph/event-graph";
import type { EventId, GraphEvent } from "../../types";
import {
  getBranchPreservingTopologicalOrder as referenceBranchPreservingOrder,
  getTopologicalOrder as referenceKahnOrder,
} from "../reference-topological-order";
import { fcParams } from "./run-config";

describe("property: EventGraph topological orders", () => {
  it.each([
    0, 1, 2, 3,
  ])("should order a custom ID matching a replica prefix with %i packed events", (packedCount) => {
    // Arrange
    const events: GraphEvent[] = [
      {
        id: "0",
        parentVersion: new Set(),
        operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "x" },
        timestamp: 0,
      },
      {
        id: "0:1",
        parentVersion: new Set(["0"]),
        operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "x" },
        timestamp: 1,
      },
      {
        id: "a",
        parentVersion: new Set(),
        operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "x" },
        timestamp: 2,
      },
    ];
    const graph = graphWithPackedPrefix(events, packedCount);

    // Act
    const kahnOrder = graph.getTopologicalOrder().map(({ id }) => id);
    const branchOrder = graph
      .getBranchPreservingTopologicalOrder()
      .map(({ id }) => id);

    // Assert
    expect(kahnOrder).toEqual(["0", "0:1", "a"]);
    expect(branchOrder).toEqual(["a", "0", "0:1"]);
  });

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

  it("should encode EGW3 from columns exactly like the event encoder", () => {
    fc.assert(
      fc.property(eventDagArb, fc.nat(), (dag, packedSeed) => {
        // Arrange
        const events = withVariedOperations(dag);
        const graph = graphWithPackedPrefix(
          events,
          packedSeed % (events.length + 1),
        );
        const expected = encodeTopologicallyOrderedEventsBinary(
          graph.getLinearReplayOrder() ?? graph.getTopologicalOrder(),
          graph.getMetadata(),
          Array.from(graph.getFrontier()),
        );

        // Act
        const encoded = graph.encodeTopologicalBinary();

        // Assert
        expect(encoded.frontier).toEqual(expected.frontier);
        expect(Buffer.from(encoded.binary).equals(expected.binary)).toBe(true);
      }),
      fcParams(),
    );
  });
});

// Helpers

/**
 * Mix inserts of varying text with deletes so every column varies, and
 * rename each group to a custom ID followed by three canonical IDs whose
 * replica prefix equals that custom ID. This exercises run boundaries and
 * keeps custom/canonical collisions in the encoder equivalence coverage.
 */
const withVariedOperations = (
  events: ReadonlyArray<GraphEvent>,
): GraphEvent[] => {
  const renamed = new Map(
    events.map((event, index) => [
      event.id,
      index % 4 === 0
        ? `agent-${Math.floor(index / 4)}`
        : `agent-${Math.floor(index / 4)}:${index % 4}`,
    ]),
  );
  const rename = (id: EventId): EventId => renamed.get(id)!;
  return events.map((event, index) => ({
    id: rename(event.id),
    parentVersion: new Set(Array.from(event.parentVersion, rename)),
    operation:
      index % 3 === 1
        ? { type: OPERATION_TYPE.DELETE, index: index % 4, length: index % 3 }
        : {
            type: OPERATION_TYPE.INSERT,
            index: index % 5,
            text: index % 3 === 2 ? "🙂y" : "x",
          },
    timestamp: index % 2 === 0 ? index : -index,
  }));
};

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
