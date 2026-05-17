/**
 * Property: `EgWalkerReplica.serialize()` → `deserialize()` and the
 * columnar codec's `encodeBinary` → `decodeBinary` are both
 * round-trips that preserve text and frontier.
 *
 * Replay-stat counters (`fullReplays`, `incrementalApplies`,
 * `sequenceRecordCount`) are intentionally not asserted: they reflect
 * which replay path produced the engine state. The original replica
 * was built via incremental applies, the restored replica via a cold
 * full replay over the deserialized graph, so the two will legitimately
 * land on different internal record layouts even though the public
 * document state matches.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { EgWalkerReplica } from "../../core/replica";
import { EventGraph } from "../../graph/event-graph";
import { ColumnarEventGraphCodec } from "../../graph/columnar-codec";
import type { EventId, GraphEvent } from "../../types";
import { cloneEvent } from "../test-helpers";
import { traceParamsArb } from "./arbitraries";
import { fcParams } from "./run-config";
import { runTrace } from "./trace-runner";

const frontierSet = (replica: EgWalkerReplica): Set<EventId> => {
  const events = replica.exportEventGraph();
  const childOf = new Map<EventId, Set<EventId>>();
  const allIds = new Set<EventId>();
  for (const event of events) {
    allIds.add(event.id);
    for (const parent of event.parentVersion) {
      if (!childOf.has(parent)) {
        childOf.set(parent, new Set());
      }
      childOf.get(parent)!.add(event.id);
    }
  }
  const frontier = new Set<EventId>();
  for (const id of allIds) {
    if (!childOf.has(id) || childOf.get(id)!.size === 0) {
      frontier.add(id);
    }
  }
  return frontier;
};

const setEquals = <T>(a: ReadonlySet<T>, b: ReadonlySet<T>): boolean => {
  if (a.size !== b.size) {
    return false;
  }
  for (const item of a) {
    if (!b.has(item)) {
      return false;
    }
  }
  return true;
};

describe("property: JSON serialize/deserialize round-trip", () => {
  it("preserves text, frontier, and sequence-record count", () => {
    fc.assert(
      fc.property(
        traceParamsArb({
          minReplicas: 2,
          maxReplicas: 3,
          minStepsPerReplica: 2,
          maxStepsPerReplica: 5,
        }),
        (params) => {
          const trace = runTrace(params);
          const original = new EgWalkerReplica("origin", params.initialText);
          for (const event of trace.events) {
            original.applyRemoteEvent(cloneEvent(event));
          }
          expect(original.getText()).toBe(trace.canonicalText);

          const serialized = original.serialize();
          // JSON round-trip — proves the on-wire payload is JSON-safe.
          const wire = JSON.parse(
            JSON.stringify(serialized),
          ) as typeof serialized;
          const restored = EgWalkerReplica.deserialize(wire, "restored");

          expect(restored.getText()).toBe(original.getText());
          expect(setEquals(frontierSet(restored), frontierSet(original))).toBe(
            true,
          );

          // The restored replica must carry the full event history,
          // so it can continue to accept new events without losing
          // causal context.
          expect(restored.exportEventGraph().length).toBe(
            original.exportEventGraph().length,
          );
        },
      ),
      fcParams(),
    );
  });
});

describe("property: columnar codec round-trip", () => {
  it("encodeBinary → decodeBinary preserves replay text", () => {
    fc.assert(
      fc.property(
        traceParamsArb({
          minReplicas: 2,
          maxReplicas: 3,
          minStepsPerReplica: 2,
          maxStepsPerReplica: 5,
        }),
        (params) => {
          const trace = runTrace(params);
          fc.pre(trace.appliedEdits > 0);

          const sourceGraph = new EventGraph();
          for (const event of trace.events.map(cloneEvent)) {
            sourceGraph.addEvent(event);
          }

          const codec = new ColumnarEventGraphCodec();
          const bytes = codec.encodeBinary(sourceGraph);
          const decoded = codec.decodeBinary(bytes);

          // Decoded graph must replay to the same text.
          const replayed = replayGraph(decoded, params.initialText);
          expect(replayed).toBe(trace.canonicalText);

          // And the in-memory `encode/decode` path round-trips too.
          const decoded2 = codec.decode(codec.encode(sourceGraph));
          expect(replayGraph(decoded2, params.initialText)).toBe(
            trace.canonicalText,
          );
        },
      ),
      fcParams(),
    );
  });
});

const replayGraph = (graph: EventGraph, initialText: string): string => {
  const replica = new EgWalkerReplica("replay", initialText);
  for (const event of graph.getTopologicalOrder()) {
    const clone: GraphEvent = {
      id: event.id,
      operation: { ...event.operation },
      parentVersion: new Set(event.parentVersion),
      timestamp: event.timestamp,
    };
    replica.applyRemoteEvent(clone);
  }
  return replica.getText();
};
