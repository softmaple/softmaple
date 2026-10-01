/**
 * Property: the EGW4 columnar codec loses nothing and accepts no damaged
 * payload.
 *
 * Graphs are generated in topological order with every shape the format
 * has a special case for: typing, delete-key and backspace runs next to
 * arbitrary edits, empty and non-BMP text, indexes and lengths beyond 32
 * bits, roots after the first event, merges of more than three parents,
 * replica runs that continue or jump, custom IDs and timestamps that step,
 * repeat or jump anywhere in the 51-bit range.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { OPERATION_TYPE } from "../../constants/operation-types";
import { ColumnarEventGraphCodec } from "../../graph/columnar-codec";
import { encodeTopologicallyOrderedEventsBinary } from "../../graph/columnar-codec/topological-binary-encoder";
import type { EventId, ExternalOperation, GraphEvent } from "../../types";
import { fcParams } from "./run-config";

describe("property: EGW4 columnar codec", () => {
  it("should decode every encoded graph to the same events, frontier and metadata", () => {
    fc.assert(
      fc.property(graphArb, ({ events, metadata }) => {
        // Arrange
        const { binary, frontier } = encodeTopologicallyOrderedEventsBinary(
          events,
          metadata,
        );

        // Act
        const decoded = new ColumnarEventGraphCodec().decodeBinary(binary);

        // Assert
        expect(eventsById(decoded.getTopologicalOrder())).toEqual(
          eventsById(events),
        );
        expect([...decoded.getFrontier()].sort()).toEqual([...frontier].sort());
        expect(JSON.stringify(decoded.getMetadata())).toBe(
          JSON.stringify(metadata),
        );
      }),
      fcParams(),
    );
  });

  it("should reject every truncated payload", () => {
    fc.assert(
      fc.property(graphArb, fc.nat(), ({ events, metadata }, cutSeed) => {
        // Arrange
        const { binary } = encodeTopologicallyOrderedEventsBinary(
          events,
          metadata,
        );
        const truncated = binary.subarray(0, cutSeed % binary.length);

        // Act
        const decode = () =>
          new ColumnarEventGraphCodec().decodeBinary(truncated);

        // Assert
        expect(decode).toThrow();
      }),
      fcParams(),
    );
  });

  it("should reject every payload with one corrupted byte after the magic", () => {
    fc.assert(
      fc.property(
        graphArb,
        fc.nat(),
        fc.integer({ min: 1, max: 0xff }),
        ({ events, metadata }, positionSeed, mask) => {
          // Arrange
          const { binary } = encodeTopologicallyOrderedEventsBinary(
            events,
            metadata,
          );
          const corrupt = binary.slice();
          const position =
            MAGIC_LENGTH + (positionSeed % (binary.length - MAGIC_LENGTH));
          corrupt[position] = corrupt[position]! ^ mask;

          // Act
          const decode = () =>
            new ColumnarEventGraphCodec().decodeBinary(corrupt);

          // Assert
          expect(decode).toThrow();
        },
      ),
      fcParams(),
    );
  });
});

// Helpers

/** Length-prefixed "EGW4" magic; corrupting it can select another decoder. */
const MAGIC_LENGTH = 5;

const TIMESTAMP_LIMIT = 2 ** 50;

const bigNatArb = (bits: bigint): fc.Arbitrary<number> =>
  fc.bigInt({ min: 0n, max: 2n ** bits }).map(Number);

const indexArb = fc.oneof(fc.nat(), bigNatArb(40n));

const timestampArb = fc
  .bigInt({ min: -BigInt(TIMESTAMP_LIMIT), max: BigInt(TIMESTAMP_LIMIT) })
  .map(Number);

/**
 * Where an event edits: continuing the previous edit (typing, delete key or
 * backspace) or anywhere.
 */
const editArb = fc.oneof(
  fc.record({
    kind: fc.constant("type" as const),
    text: fc.string({ unit: "binary" }),
  }),
  fc.record({ kind: fc.constant("delete-key" as const), length: indexArb }),
  fc.record({ kind: fc.constant("backspace" as const), length: indexArb }),
  fc.record({
    kind: fc.constant("insert" as const),
    index: indexArb,
    text: fc.string({ unit: "binary" }),
  }),
  fc.record({
    kind: fc.constant("delete" as const),
    index: indexArb,
    length: indexArb,
  }),
);

/** Event ID: the next sequence of the previous replica, or any string. */
const idArb = fc.oneof(
  fc.constant(null),
  fc.string({
    minLength: 1,
    unit: fc.constantFrom("a", "b", ":", "0", "1", "9"),
  }),
  fc
    .tuple(
      fc.constantFrom("alice", "bob", "paper:C1:agent:0", "🙂"),
      fc.oneof(fc.nat(), fc.maxSafeNat()),
    )
    .map(([replica, sequence]) => `${replica}:${sequence}`),
);

const eventSpecArb = fc.record({
  id: idArb,
  // `null`: the previous event is the only parent.
  parentSeeds: fc.oneof(fc.constant(null), fc.array(fc.nat())),
  edit: editArb,
  // `null`: the timestamp keeps the previous step.
  timestamp: fc.oneof(fc.constant(null), timestampArb),
});

const graphArb = fc
  .record({
    specs: fc.array(eventSpecArb),
    metadata: fc.dictionary(fc.string(), fc.jsonValue()),
  })
  .map(({ specs, metadata }) => ({ events: buildEvents(specs), metadata }));

type EventSpec = typeof eventSpecArb extends fc.Arbitrary<infer T> ? T : never;

const buildEvents = (specs: ReadonlyArray<EventSpec>): GraphEvent[] => {
  const events: GraphEvent[] = [];
  const used = new Set<EventId>();
  for (const [position, spec] of specs.entries()) {
    const previous = events[position - 1];
    const id = uniqueId(spec.id, previous?.id, position, used);
    used.add(id);
    const parents =
      spec.parentSeeds === null
        ? previous === undefined
          ? []
          : [previous.id]
        : position === 0
          ? []
          : spec.parentSeeds.map((seed) => events[seed % position]!.id);
    events.push({
      id,
      parentVersion: new Set(parents),
      operation: operationAfter(spec.edit, previous?.operation),
      timestamp: timestampAfter(spec.timestamp, events),
    });
  }
  return events;
};

const uniqueId = (
  candidate: EventId | null,
  previousId: EventId | undefined,
  position: number,
  used: ReadonlySet<EventId>,
): EventId => {
  let id = candidate;
  if (id === null) {
    const colon = previousId?.lastIndexOf(":") ?? -1;
    const sequence = colon > 0 ? Number(previousId!.slice(colon + 1)) : NaN;
    id = Number.isSafeInteger(sequence)
      ? `${previousId!.slice(0, colon)}:${sequence + 1}`
      : `fresh:${position}`;
  }
  // The generated alphabets never spell "unique", so this cannot collide.
  return used.has(id) ? `unique-${position}` : id;
};

const operationAfter = (
  edit: EventSpec["edit"],
  previous: ExternalOperation | undefined,
): ExternalOperation => {
  const previousIndex = previous?.index ?? 0;
  const previousEnd =
    previous?.type === OPERATION_TYPE.INSERT
      ? previousIndex + previous.text.length
      : previousIndex;
  switch (edit.kind) {
    case "type":
      return {
        type: OPERATION_TYPE.INSERT,
        index: previousEnd,
        text: edit.text,
      };
    case "delete-key":
      return {
        type: OPERATION_TYPE.DELETE,
        index: previousIndex,
        length: edit.length,
      };
    case "backspace":
      return {
        type: OPERATION_TYPE.DELETE,
        index: Math.max(0, previousIndex - edit.length),
        length: edit.length,
      };
    case "insert":
      return {
        type: OPERATION_TYPE.INSERT,
        index: edit.index,
        text: edit.text,
      };
    case "delete":
      return {
        type: OPERATION_TYPE.DELETE,
        index: edit.index,
        length: edit.length,
      };
  }
};

const timestampAfter = (
  timestamp: number | null,
  earlier: ReadonlyArray<GraphEvent>,
): number => {
  if (timestamp !== null) {
    return timestamp;
  }
  const last = earlier[earlier.length - 1]?.timestamp ?? 0;
  const beforeLast = earlier[earlier.length - 2]?.timestamp ?? last;
  const stepped = last + (last - beforeLast);
  return Math.abs(stepped) <= TIMESTAMP_LIMIT ? stepped : last;
};

/** Events by ID, with parents as arrays so their order is compared too. */
const eventsById = (events: ReadonlyArray<GraphEvent>) =>
  events
    .map((event) => ({
      id: event.id,
      parents: [...event.parentVersion],
      operation: event.operation,
      timestamp: event.timestamp,
    }))
    .sort((left, right) => (left.id < right.id ? -1 : 1));
