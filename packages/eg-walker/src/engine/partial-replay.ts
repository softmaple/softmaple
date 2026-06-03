import { EgWalkerEngine, type GeneratedDocument } from "./eg-walker-engine";
import type { EventGraph } from "../graph/event-graph";
import { compareEventIds } from "../graph/event-id";
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
    const events = replayedEventIds
      .map((eventId) => graph.getEvent(eventId))
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
    // Section 3.4: walk the divergent suffix in branch-preserving order so
    // each event lands on a parent version matching the engine's current
    // version where possible, keeping the replay on the non-conflicting-run
    // fast path and minimising retreat/advance churn. Only the divergent
    // suffix is replayed, so compute the branch-preserving order on that
    // suffix instead of sorting the whole graph on every partial replay.
    return getBranchPreservingReplayOrder(graph, onlyInRight);
  }
}

const getBranchPreservingReplayOrder = (
  graph: EventGraph,
  replayEventIds: ReadonlySet<EventId>,
): ReadonlyArray<EventId> => {
  const remainingParents = new Map<EventId, number>();
  const children = new Map<EventId, EventId[]>();
  const roots: EventId[] = [];

  for (const eventId of replayEventIds) {
    const event = graph.getEvent(eventId);
    if (!event) {
      continue;
    }

    let parentCount = 0;
    for (const parentId of event.parentVersion) {
      if (!replayEventIds.has(parentId)) {
        continue;
      }
      parentCount++;
      const childIds = children.get(parentId) ?? [];
      childIds.push(eventId);
      children.set(parentId, childIds);
    }

    remainingParents.set(eventId, parentCount);
    if (parentCount === 0) {
      roots.push(eventId);
    }
  }

  roots.sort(compareEventIds);

  const stack: EventId[] = [];
  for (let i = roots.length - 1; i >= 0; i--) {
    stack.push(roots[i]!);
  }

  const ordered: EventId[] = [];
  const visited = new Set<EventId>();

  while (stack.length > 0) {
    const eventId = stack.pop()!;
    if (visited.has(eventId)) {
      continue;
    }
    visited.add(eventId);
    ordered.push(eventId);

    const childIds = children.get(eventId);
    if (!childIds || childIds.length === 0) {
      continue;
    }

    const newlyReady: EventId[] = [];
    for (const childId of childIds) {
      const remaining = (remainingParents.get(childId) ?? 0) - 1;
      remainingParents.set(childId, remaining);
      if (remaining === 0) {
        newlyReady.push(childId);
      }
    }
    newlyReady.sort(compareEventIds);
    for (let i = newlyReady.length - 1; i >= 0; i--) {
      stack.push(newlyReady[i]!);
    }
  }

  if (ordered.length !== remainingParents.size) {
    throw new Error("Cycle detected in partial replay suffix");
  }

  return ordered;
};
