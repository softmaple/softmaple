/**
 * Property: after a packed cold replay, moving the engine's prepare view to
 * any version shows that version's document as the scalar reference replay
 * builds it.
 *
 * A transition walks each range of the version diff once: an author's
 * keystrokes as one span of records, and each delete's recorded targets,
 * including targets kept lazily inside a typed run and placeholder ranges
 * of the initial text. The cold replay moves between its events the same
 * way. The reference shares no engine, ranked-tree or event-graph code, so
 * this pins down span toggling, delete targets and the weight batch.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { materializeScalarReferenceVersion } from "../../conformance/scalar-reference-replay";
import { EgWalkerEngine } from "../../engine/eg-walker-engine";
import { planPackedCriticalReplaySections } from "../../engine/packed-critical-replay-plan";
import { ColumnarEventGraphCodec } from "../../graph/columnar-codec";
import { EventGraph } from "../../graph/event-graph";
import { PersistentUtf16Rope } from "../../text/persistent-utf16-rope";
import type { GraphEvent, Version } from "../../types";
import { traceParamsArb } from "./arbitraries";
import { fcParams } from "./run-config";
import { runTrace } from "./trace-runner";

describe("EgWalkerEngine.transitionPrepareView", () => {
  it("should always show the scalar reference document of the version it moves to", () => {
    fc.assert(
      fc.property(
        // Longer scripts with more deletes and fewer syncs, so that
        // transitions retreat and re-advance delete-key runs and deletes of
        // the initial text, not only keystrokes.
        traceParamsArb({
          maxStepsPerReplica: 16,
          deleteWeight: 6,
          syncEveryNArb: fc.integer({ min: 4, max: 12 }),
        }),
        fc.array(fc.array(fc.nat())),
        (params, versionPicks) => {
          // Arrange
          const trace = runTrace(params, {
            typeInserts: true,
            typeDeletes: true,
          });
          fc.pre(trace.events.length > 0);
          const graph = pack(trace.events);
          const engine = replayPacked(graph, params.initialText);
          const versions = [
            graph.getFrontier(),
            ...versionPicks.map((picks) => versionOf(trace.events, picks)),
          ];

          // Act
          const views = versions.map((version) => {
            engine.transitionPrepareView(version, graph);
            return engine.getPrepareSlice(0, engine.getPrepareLength());
          });

          // Assert
          expect(views).toEqual(
            versions.map((version) =>
              materializeScalarReferenceVersion(
                trace.events,
                version,
                params.initialText,
              ),
            ),
          );
        },
      ),
      fcParams(),
    );
  }, 120_000);
});

// Helpers

const pack = (events: ReadonlyArray<GraphEvent>): EventGraph => {
  const codec = new ColumnarEventGraphCodec();
  return codec.decodeBinary(codec.encodeBinary(EventGraph.fromEvents(events)));
};

/** Replay the whole packed graph in one engine and keep it for transitions. */
const replayPacked = (
  graph: EventGraph,
  initialText: string,
): EgWalkerEngine => {
  const plan = planPackedCriticalReplaySections(graph);
  if (plan === null) {
    throw new Error("A decoded graph has a packed replay plan");
  }
  const engine = new EgWalkerEngine();
  engine.generatePackedSectionRange(
    plan,
    0,
    plan.sectionCount,
    graph,
    new Set(),
    PersistentUtf16Rope.from(initialText),
  );
  engine.preparePackedRetention(plan, 0, plan.sectionCount);
  return engine;
};

/** The version of the events `picks` name, taken modulo the event count. */
const versionOf = (
  events: ReadonlyArray<GraphEvent>,
  picks: ReadonlyArray<number>,
): Version => new Set(picks.map((pick) => events[pick % events.length]!.id));
