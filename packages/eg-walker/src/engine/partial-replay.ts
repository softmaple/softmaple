import { EgWalkerEngine, type GeneratedDocument } from "./eg-walker-engine";
import type { EventGraph } from "../graph/event-graph";
import type { EventId, Version } from "../types";

export interface ReplayCheckpoint {
  readonly version: Version;
  readonly text: string;
}

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
  ): PartialReplayResult {
    const replayedEventIds = this.getReplayEventIds(
      graph,
      checkpoint.version,
      targetVersion,
    );
    const eventById = new Map(
      graph.getTopologicalOrder().map((event) => [event.id, event]),
    );
    const events = replayedEventIds
      .map((eventId) => eventById.get(eventId))
      .filter(
        (event): event is NonNullable<typeof event> => event !== undefined,
      );
    const engine = new EgWalkerEngine();
    const generated = engine.generate(events, checkpoint.text, {
      initialVersion: checkpoint.version,
      eventGraph: graph,
    });

    return {
      ...generated,
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
    return graph
      .getTopologicalOrder()
      .map((event) => event.id)
      .filter((eventId) => onlyInRight.has(eventId));
  }
}
