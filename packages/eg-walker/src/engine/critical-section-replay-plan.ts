import type { EventGraph } from "../graph/event-graph";
import { EventGraph as EventGraphClass } from "../graph/event-graph";
import type { EventId, GraphEvent, Version } from "../types";

/**
 * A replay section bounded by critical frontiers.
 *
 * Every event in the section is causally after `baseFrontier`, and
 * `endFrontier` either dominates every remaining event or is the graph's
 * final frontier. A replay executor can therefore release temporary CRDT
 * state after finishing a section.
 */
export interface CriticalReplaySection {
  readonly events: ReadonlyArray<GraphEvent>;
  readonly baseFrontier: Version;
  readonly endFrontier: Version;
}

/**
 * Partition a graph, or an already branch-preserving topological order, at
 * critical frontiers.
 *
 * A prefix frontier is safe to cut when it occurs in the parent version of
 * every currently-ready suffix root. Every remaining event is reachable from
 * one of those roots, so all remaining events are causally after the cut. The
 * final graph frontier is always emitted as a cut, including graphs whose
 * branches never rejoin.
 *
 * The input array must contain the complete graph in topological order. When
 * an {@link EventGraph} is supplied, its deterministic branch-preserving
 * order is used.
 *
 * The planner maintains the number of missing `(frontier, ready-root)` parent
 * pairs incrementally. Each event and edge enters and leaves that accounting
 * a constant number of times, giving expected `O(V + E + F)` time with hash
 * maps, where `F` is the total size of the frontier copies in the result.
 * Working space is `O(V + E)`.
 */
export const planCriticalReplaySections = (
  source: EventGraph | ReadonlyArray<GraphEvent>,
): ReadonlyArray<CriticalReplaySection> => {
  const sourceIsGraph = source instanceof EventGraphClass;
  const graphLinearEvents = sourceIsGraph
    ? source.getLinearReplayOrder()
    : null;
  if (graphLinearEvents !== null) {
    if (graphLinearEvents.length === 0) {
      return Object.freeze([]);
    }
    const last = graphLinearEvents[graphLinearEvents.length - 1]!;
    return Object.freeze([
      Object.freeze({
        events: graphLinearEvents,
        baseFrontier: new Set<EventId>(),
        endFrontier: new Set([last.id]),
      }),
    ]);
  }
  const orderedEvents = sourceIsGraph
    ? source.getBranchPreservingTopologicalOrder()
    : source;

  if (orderedEvents.length === 0) {
    return Object.freeze([]);
  }

  // A fully linear history never needs temporary CRDT state, so emitting one
  // section per (technically critical) event would only create O(V) tiny
  // arrays, sets, and section objects. Collapse the whole chain into one
  // rope-only replay section. The final frontier is still a valid critical
  // cut and the executor can apply every operation directly.
  const linearEnd = getLinearEndFrontier(orderedEvents, sourceIsGraph);
  if (linearEnd !== null) {
    return Object.freeze([
      Object.freeze({
        events: sourceIsGraph
          ? orderedEvents
          : Object.freeze(orderedEvents.slice()),
        baseFrontier: new Set<EventId>(),
        endFrontier: linearEnd,
      }),
    ]);
  }

  const graph = buildPlanningGraph(
    orderedEvents,
    sourceIsGraph ? source : null,
  );
  const prefixFrontier = new Set<EventId>();
  const readyParentCoverage = new Map<EventId, number>();
  const sections: CriticalReplaySection[] = [];

  let missingReadyParentPairs = 0;
  let sectionStart = 0;
  let sectionBase: Version = new Set<EventId>();

  for (let index = 0; index < orderedEvents.length; index++) {
    const event = orderedEvents[index]!;
    if (!graph.ready.delete(event.id)) {
      throw new Error(
        `Critical replay planning requires topological order; event ${event.id} is not ready`,
      );
    }

    // Remove this ready root's contribution to the missing-pair count.
    missingReadyParentPairs -=
      prefixFrontier.size -
      countParentsInFrontier(event.parentVersion, prefixFrontier);
    removeParentCoverage(readyParentCoverage, event.parentVersion);

    // Advance the prefix frontier. Coverage is measured against the ready set
    // after removing the current event and before exposing its newly-ready
    // children.
    for (const parentId of event.parentVersion) {
      if (!prefixFrontier.has(parentId)) {
        continue;
      }
      missingReadyParentPairs -=
        graph.ready.size - (readyParentCoverage.get(parentId) ?? 0);
      prefixFrontier.delete(parentId);
    }
    prefixFrontier.add(event.id);
    missingReadyParentPairs +=
      graph.ready.size - (readyParentCoverage.get(event.id) ?? 0);

    // Advancing the current event may expose one or more suffix roots. Add
    // each root's missing frontier parents without scanning the ready set.
    for (const childId of graph.childrenOf(event.id)) {
      const remaining = (graph.remainingParents.get(childId) ?? 0) - 1;
      graph.remainingParents.set(childId, remaining);
      if (remaining !== 0) {
        continue;
      }

      const childParents = graph.parentsOf(childId);
      missingReadyParentPairs +=
        prefixFrontier.size -
        countParentsInFrontier(childParents, prefixFrontier);
      addParentCoverage(readyParentCoverage, graph.parentsOf(childId));
      graph.ready.add(childId);
    }

    const isFinalFrontier = graph.ready.size === 0;
    const isCriticalCut = isFinalFrontier || missingReadyParentPairs === 0;
    if (!isCriticalCut) {
      continue;
    }

    const endFrontier = new Set(prefixFrontier);
    sections.push(
      Object.freeze({
        events: Object.freeze(orderedEvents.slice(sectionStart, index + 1)),
        baseFrontier: sectionBase,
        endFrontier,
      }),
    );
    sectionStart = index + 1;
    sectionBase = new Set(endFrontier);
  }

  return Object.freeze(sections);
};

const getLinearEndFrontier = (
  orderedEvents: ReadonlyArray<GraphEvent>,
  idsAlreadyValidated: boolean,
): Version | null => {
  let previousId: EventId | null = null;
  const seen = idsAlreadyValidated ? null : new Set<EventId>();
  for (const event of orderedEvents) {
    if (seen?.has(event.id)) {
      throw new Error(
        `Duplicate event ID in critical replay plan: ${event.id}`,
      );
    }
    seen?.add(event.id);
    if (previousId === null) {
      if (event.parentVersion.size !== 0) {
        return null;
      }
    } else if (
      event.parentVersion.size !== 1 ||
      !event.parentVersion.has(previousId)
    ) {
      return null;
    }
    previousId = event.id;
  }
  return previousId === null ? new Set() : new Set([previousId]);
};

interface PlanningGraph {
  readonly childrenOf: (eventId: EventId) => Iterable<EventId>;
  readonly parentsOf: (eventId: EventId) => Iterable<EventId>;
  readonly remainingParents: Map<EventId, number>;
  readonly ready: Set<EventId>;
}

const buildPlanningGraph = (
  orderedEvents: ReadonlyArray<GraphEvent>,
  sourceGraph: EventGraph | null,
): PlanningGraph => {
  if (sourceGraph !== null) {
    const remainingParents = new Map<EventId, number>();
    const ready = new Set<EventId>();
    for (const event of orderedEvents) {
      remainingParents.set(event.id, event.parentVersion.size);
      if (event.parentVersion.size === 0) {
        ready.add(event.id);
      }
    }
    return {
      childrenOf: (eventId) => sourceGraph.iterateChildren(eventId),
      parentsOf: (eventId) => sourceGraph.iterateParents(eventId),
      remainingParents,
      ready,
    };
  }

  const eventById = new Map<EventId, GraphEvent>();
  for (const event of orderedEvents) {
    if (eventById.has(event.id)) {
      throw new Error(
        `Duplicate event ID in critical replay plan: ${event.id}`,
      );
    }
    eventById.set(event.id, event);
  }

  const childrenById = new Map<EventId, EventId[]>();
  const remainingParents = new Map<EventId, number>();
  const ready = new Set<EventId>();

  for (const event of orderedEvents) {
    remainingParents.set(event.id, event.parentVersion.size);
    if (event.parentVersion.size === 0) {
      ready.add(event.id);
    }

    for (const parentId of event.parentVersion) {
      if (!eventById.has(parentId)) {
        throw new Error(
          `Unknown parent ${parentId} in critical replay plan for event ${event.id}`,
        );
      }
      const children = childrenById.get(parentId) ?? [];
      children.push(event.id);
      childrenById.set(parentId, children);
    }
  }

  return {
    childrenOf: (eventId) => childrenById.get(eventId) ?? [],
    parentsOf: (eventId) => eventById.get(eventId)?.parentVersion ?? [],
    remainingParents,
    ready,
  };
};

const countParentsInFrontier = (
  parents: Iterable<EventId>,
  frontier: ReadonlySet<EventId>,
): number => {
  let count = 0;
  for (const parentId of parents) {
    if (frontier.has(parentId)) {
      count++;
    }
  }
  return count;
};

const addParentCoverage = (
  coverage: Map<EventId, number>,
  parents: Iterable<EventId>,
): void => {
  for (const parentId of parents) {
    coverage.set(parentId, (coverage.get(parentId) ?? 0) + 1);
  }
};

const removeParentCoverage = (
  coverage: Map<EventId, number>,
  parents: Iterable<EventId>,
): void => {
  for (const parentId of parents) {
    const next = (coverage.get(parentId) ?? 0) - 1;
    if (next === 0) {
      coverage.delete(parentId);
    } else {
      coverage.set(parentId, next);
    }
  }
};
