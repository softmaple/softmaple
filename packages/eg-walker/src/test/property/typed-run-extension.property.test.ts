/**
 * Property: typing inside a document merges exactly like one item per
 * keystroke.
 *
 * A keystroke that lands right after its author's typed-run record joins it
 * wherever the record sits in the document, so the engine keeps one record
 * per stretch of keystrokes. The scalar reference replay keeps one item per
 * code unit instead and shares no engine code. Replicas here type and press
 * delete one scalar per event at a few shared cursor positions, so their
 * runs keep landing next to each other's concurrent keystrokes, deletes and
 * runs. Every replay path must build the reference document: the live
 * replicas, the object replay with and without transformed operations, and
 * the packed cold replay.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { materializeScalarReferenceVersion } from "../../conformance/scalar-reference-replay";
import { OPERATION_TYPE } from "../../constants/operation-types";
import { EgWalkerReplica } from "../../core/replica";
import { EgWalkerEngine } from "../../engine/eg-walker-engine";
import { ColumnarEventGraphCodec } from "../../graph/columnar-codec";
import { EventGraph } from "../../graph/event-graph";
import type { ExternalOperation, GraphEvent } from "../../types";
import {
  bmpTextArb,
  replicaIdArb,
  SEED_TEXTS,
  type EditInstruction,
  type TraceParams,
} from "./arbitraries";
import { fcParams } from "./run-config";
import { runTrace } from "./trace-runner";

describe("property: typing inside a document", () => {
  it("should merge like one item per keystroke on every replay path", () => {
    fc.assert(
      fc.property(sharedCursorTraceArb, (params) => {
        // Arrange
        const trace = runTrace(params, {
          typeInserts: true,
          typeDeletes: true,
        });
        const graph = EventGraph.fromEvents(trace.events);
        const expected = materializeScalarReferenceVersion(
          trace.events,
          graph.getFrontier(),
          params.initialText,
        );

        // Act
        const eager = new EgWalkerEngine().generate(
          trace.events,
          params.initialText,
          { eventGraph: graph },
        );
        const batched = new EgWalkerEngine().generate(
          trace.events,
          params.initialText,
          { eventGraph: graph, collectTransformedOperations: false },
        );
        const coldLoaded = new EgWalkerReplica(
          "cold-load",
          params.initialText,
          pack(trace.events),
        ).getText();

        // Assert
        for (const text of trace.finalTextPerReplica.values()) {
          expect(text).toBe(expected);
        }
        expect(eager.text).toBe(expected);
        expect(
          applyOperations(params.initialText, eager.transformedOperations),
        ).toBe(expected);
        expect(batched.text).toBe(expected);
        expect(coldLoaded).toBe(expected);
      }),
      fcParams(),
    );
  }, 120_000);
});

// Helpers

/**
 * Edits at one of five cursor positions (start, quarters, end) of the
 * replica's current text, so that concurrent edits keep landing at the same
 * places: right after another replica's run, or inside it.
 */
const cursorSeedArb = fc
  .integer({ min: 0, max: 4 })
  .map((cursor) => cursor / 4);

const sharedCursorEditArb: fc.Arbitrary<EditInstruction> = fc.oneof(
  {
    weight: 3,
    arbitrary: fc.record({
      kind: fc.constant("insert" as const),
      offsetSeed: cursorSeedArb,
      text: bmpTextArb(),
    }),
  },
  {
    weight: 1,
    arbitrary: fc.record({
      kind: fc.constant("delete" as const),
      offsetSeed: cursorSeedArb,
      lengthSeed: fc.double({ min: 0, max: 1, noNaN: true }),
    }),
  },
);

const sharedCursorTraceArb: fc.Arbitrary<TraceParams> = fc
  .tuple(
    fc.uniqueArray(replicaIdArb, { minLength: 2, maxLength: 4 }),
    fc.constantFrom(...SEED_TEXTS),
    fc.integer({ min: 1, max: 7 }),
  )
  .chain(([replicaIds, initialText, syncEveryN]) =>
    fc
      .tuple(
        ...replicaIds.map((replicaId) =>
          fc
            .array(sharedCursorEditArb, { minLength: 2 })
            .map((edits) => ({ replicaId, edits })),
        ),
      )
      .map((scripts) => ({ initialText, scripts, syncEveryN })),
  );

/** `events` decoded from EGW4 bytes, so that a replica replays them packed. */
const pack = (events: ReadonlyArray<GraphEvent>): EventGraph => {
  const codec = new ColumnarEventGraphCodec();
  return codec.decodeBinary(codec.encodeBinary(EventGraph.fromEvents(events)));
};

/** Apply transformed operations to `text` in order. */
const applyOperations = (
  text: string,
  operations: ReadonlyArray<ExternalOperation>,
): string =>
  operations.reduce(
    (document, operation) =>
      operation.type === OPERATION_TYPE.INSERT
        ? document.slice(0, operation.index) +
          operation.text +
          document.slice(operation.index)
        : document.slice(0, operation.index) +
          document.slice(operation.index + operation.length),
    text,
  );
