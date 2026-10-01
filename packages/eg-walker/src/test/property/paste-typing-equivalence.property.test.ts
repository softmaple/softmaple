/**
 * Property: a multi-character insert merges exactly like the same text typed
 * one Unicode scalar per event.
 *
 * The engine integrates a multi-character insert as one insert-run record and
 * splits it only where a later insert or delete lands. Typing the same text
 * produces one event per scalar instead, so every code unit is its own CRDT
 * item from the start. Both worlds run the same multi-replica script; syncs
 * happen only between instructions, so every other replica sees either none
 * or all of an instruction's text. Any divergence means the run record
 * changed the merge semantics of the chain it stands for.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { EgWalkerReplica } from "../../core/replica";
import { ColumnarEventGraphCodec } from "../../graph/columnar-codec";
import { EventGraph } from "../../graph/event-graph";
import type { GraphEvent } from "../../types";
import {
  bmpTextArb,
  surrogateBiasedTextArb,
  traceParamsArb,
} from "./arbitraries";
import { fcParams } from "./run-config";
import { runTrace, type TraceResult } from "./trace-runner";

describe("property: pasting and typing merge identically", () => {
  it(
    "should produce identical documents under random concurrent edits",
    {
      // Each run replays two traces and cold-loads one of them; under
      // coverage instrumentation the default run count needs longer than the
      // default per-test timeout.
      timeout: 60_000,
    },
    () => {
      fc.assert(
        fc.property(
          traceParamsArb({
            minReplicas: 2,
            maxReplicas: 4,
            minStepsPerReplica: 2,
            maxStepsPerReplica: 8,
            textArb: pasteTextArb,
          }),
          (params) => {
            // Act
            const pasted = runTrace(params);
            const typed = runTrace(params, { typeInserts: true });
            const coldLoaded = coldLoad(pasted.events, params.initialText);

            // Assert
            expectConverged(pasted);
            expectConverged(typed);
            expect(pasted.canonicalText).toBe(typed.canonicalText);
            expect(pasted.finalTextPerReplica).toEqual(
              typed.finalTextPerReplica,
            );
            expect(coldLoaded).toBe(typed.canonicalText);
          },
        ),
        fcParams(),
      );
    },
  );
});

// Helpers

/** Multi-character pastes, with surrogate pairs to split around. */
const pasteTextArb = fc.oneof(
  { weight: 3, arbitrary: bmpTextArb({ minLength: 2, maxLength: 12 }) },
  {
    weight: 1,
    arbitrary: surrogateBiasedTextArb({ minLength: 1, maxLength: 6 }),
  },
);

const expectConverged = (trace: TraceResult): void => {
  for (const text of trace.finalTextPerReplica.values()) {
    expect(text).toBe(trace.canonicalText);
  }
};

/** Replay `events` from columnar bytes, through the packed section path. */
const coldLoad = (
  events: ReadonlyArray<GraphEvent>,
  initialText: string,
): string => {
  const codec = new ColumnarEventGraphCodec();
  const graph = codec.decodeBinary(
    codec.encodeBinary(EventGraph.fromEvents(events)),
  );
  return new EgWalkerReplica("cold-load", initialText, graph).getText();
};
