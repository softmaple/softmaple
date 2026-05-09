import { EgWalkerEngine, type GeneratedDocument } from "./eg-walker-engine";
import type { EventGraph } from "../graph/event-graph";
import type { EventId, Version } from "../types";

export interface ReplayCheckpoint {
  readonly version: Version;
  readonly text: string;
}

export interface PartialReplayResult extends GeneratedDocument {
  readonly replayedEventIds: ReadonlyArray<EventId>;
}

/**
 * Section 3.6 partial replay.
 *
 * A checkpoint represents a critical version whose document text is already
 * known. Replaying from it only walks events in targetVersion \ checkpoint,
 * while using the full event graph to interpret transitive version diffs.
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
    const generated = new EgWalkerEngine().generate(events, checkpoint.text, {
      initialVersion: checkpoint.version,
      eventGraph: graph,
    });

    return {
      ...generated,
      replayedEventIds,
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
