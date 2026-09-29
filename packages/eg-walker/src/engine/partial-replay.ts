import { EgWalkerEngine, type GeneratedDocument } from "./eg-walker-engine";
import type { EventGraph } from "../graph/event-graph";
import type { EventId, Version } from "../types";
import { PersistentUtf16Rope } from "../text/persistent-utf16-rope";

interface ReplayCheckpointBase {
  readonly version: Version;
}

export type ReplayCheckpoint = ReplayCheckpointBase &
  (
    | {
        readonly text: string;
        readonly textBuffer?: PersistentUtf16Rope;
      }
    | {
        readonly text?: string;
        readonly textBuffer: PersistentUtf16Rope;
      }
  );

export interface PartialReplayResult extends GeneratedDocument {
  readonly replayedEventIds: ReadonlyArray<EventId>;
  /**
   * The engine that produced this result. Callers that need to keep applying
   * subsequent events incrementally (e.g. {@link EgWalkerReplica}) adopt this
   * engine instead of starting a fresh one, preserving the placeholder state
   * built up during partial replay.
   */
  readonly engine: EgWalkerEngine;
}

export interface PartialReplayOptions {
  readonly collectTransformedOperations?: boolean;
}

/**
 * Section 3.6 partial replay.
 *
 * A checkpoint represents a critical version whose document text is already
 * known. Replaying from it only walks events in targetVersion \ checkpoint,
 * while using the full event graph to interpret transitive version diffs.
 *
 * Pre-checkpoint content is fed to the engine as initial text alongside
 * `initialVersion`, which triggers the engine's placeholder-seeded reset so the
 * CRDT state is O(replayed events) rather than O(checkpoint length).
 */
export class PartialReplayManager {
  replayFromCheckpoint(
    graph: EventGraph,
    checkpoint: ReplayCheckpoint,
    targetVersion: Version = graph.getFrontier(),
    options: PartialReplayOptions = {},
  ): PartialReplayResult {
    const replayedEventIds = this.getReplayEventIds(
      graph,
      checkpoint.version,
      targetVersion,
    );
    const events = replayedEventIds
      .map((eventId) => graph.getEvent(eventId))
      .filter(
        (event): event is NonNullable<typeof event> => event !== undefined,
      );
    const engine = new EgWalkerEngine();
    const initialTextBuffer = checkpointBuffer(checkpoint);
    const generated = engine.generate(events, "", {
      initialVersion: checkpoint.version,
      initialTextBuffer,
      eventGraph: graph,
      eventOrder: events,
      collectTransformedOperations:
        options.collectTransformedOperations ?? true,
    });
    const textBuffer = generated.textBuffer;

    return {
      get text(): string {
        return textBuffer.toString();
      },
      textBuffer,
      transformedOperations: generated.transformedOperations,
      stats: generated.stats,
      replayedEventIds,
      engine,
    };
  }

  getReplayEventIds(
    graph: EventGraph,
    from: Version,
    to: Version,
  ): ReadonlyArray<EventId> {
    const { onlyInRight } = graph.diffVersions(from, to);
    // Section 3.4: walk the divergent suffix in branch-preserving order so
    // each event lands on a parent version matching the engine's current
    // version where possible, keeping the replay on the non-conflicting-run
    // fast path and minimising retreat/advance churn. Only the divergent
    // suffix is replayed, so compute the branch-preserving order on that
    // suffix instead of sorting the whole graph on every partial replay.
    return graph.getRankedReplayOrder(onlyInRight);
  }
}

const checkpointBuffer = (
  checkpoint: ReplayCheckpoint,
): PersistentUtf16Rope => {
  if (checkpoint.textBuffer !== undefined) {
    return checkpoint.textBuffer;
  }
  if (checkpoint.text !== undefined) {
    return PersistentUtf16Rope.from(checkpoint.text);
  }
  throw new Error("Replay checkpoint requires text or textBuffer content");
};
