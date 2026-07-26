import type { EventGraph } from "../graph/event-graph";
import type { EventId, Version } from "../types";

export interface CriticalCheckpoint {
  readonly version: Version;
  readonly text: string;
}

/**
 * Section 3.5 critical-version detector.
 *
 * A version is critical when its transitive event set partitions the graph:
 * every event outside the version happened after at least one frontier event
 * in the version, and no outside event is concurrent with the version
 * boundary.
 *
 * The naive implementation iterates every event in the graph and calls
 * `isAncestor(frontierId, outsideId)` for each frontier id, which costs
 * O(|V| * |E|) per check. {@link isCritical} replaces that with one forward
 * BFS per frontier id, intersecting the strict-descendant sets, then deciding
 * via a single cardinality comparison. Combined with the topological-order
 * cache on {@link EventGraph}, {@link latestCriticalVersion} avoids full
 * graph traversal on every event.
 */
export class CriticalVersionAnalyzer {
  /**
   * Returns true iff `version` is a critical frontier of `graph`: every
   * event not in `expandVersion(version)` must be a strict descendant of
   * every frontier event in `version`.
   *
   * Algorithm:
   *   1. Expand `version` backward to its full ancestor closure (`before`).
   *   2. Compute the set of strict forward-descendants for each frontier id
   *      and intersect them. The intersection is exactly the set of events
   *      that have every frontier id as an ancestor.
   *   3. Because ancestors and descendants of a fixed event partition the
   *      events comparable with it, `before` and the intersection are
   *      disjoint. So the version is critical iff
   *      `|before| + |intersection| === |allEvents|`.
   *
   * Each per-frontier BFS visits every edge at most once, so the total cost
   * is O(|version| * (|V| + |E|)). For the singleton case used by
   * {@link latestCriticalVersion} and the replica's checkpoint logic this
   * collapses to a single O(|V| + |E|) sweep, replacing the previous
   * O(|V| * (|V| + |E|)) repeated `isAncestor` walk.
   */
  isCritical(graph: EventGraph, version: Version): boolean {
    const eventCount = graph.getEventCount();
    const before = graph.expandVersion(version);

    if (before.size === 0) {
      return eventCount === 0;
    }

    const outsideCount = eventCount - before.size;
    if (outsideCount === 0) {
      return true;
    }

    let intersection: Set<EventId> | null = null;
    for (const frontierId of version) {
      const descendants = collectStrictDescendants(graph, frontierId);
      if (intersection === null) {
        intersection = descendants;
      } else {
        // Shrink the intersection in place by removing anything that the
        // new frontier id does not also dominate. Iterating the existing
        // (typically smaller) intersection avoids allocating a fresh set
        // when one frontier id has many more descendants than another.
        for (const id of intersection) {
          if (!descendants.has(id)) {
            intersection.delete(id);
          }
        }
      }
      if (intersection.size < outsideCount) {
        // No way to grow the intersection back to `outsideCount` by adding
        // more frontier constraints — intersections only shrink — so the
        // version cannot be critical.
        return false;
      }
    }

    return (intersection?.size ?? 0) === outsideCount;
  }

  /**
   * Latest critical version of the graph in topological order, or `null` if
   * none exist (only the empty graph).
   *
   * In practice the result is always the current frontier when the graph is
   * non-empty: `expandVersion(frontier)` covers every event, so the loop
   * body in `isCritical` never finds a counterexample. The explicit loop is
   * preserved so callers that depend on the singleton-by-singleton scan
   * (e.g. tests) see the same ordering, but each iteration now uses the
   * optimized {@link isCritical} above and the cached topological order on
   * {@link EventGraph}, dropping the overall complexity from
   * O(|V|^2 * (|V| + |E|)) to O(|V| * (|V| + |E|)) with no per-call
   * topological recomputation.
   */
  latestCriticalVersion(graph: EventGraph): Version | null {
    const topo = graph.getTopologicalOrder();
    let latest: Version | null = null;

    for (const event of topo) {
      const version = new Set<EventId>([event.id]);
      if (this.isCritical(graph, version)) {
        latest = version;
      }
    }

    const frontier = graph.getFrontier();
    if (this.isCritical(graph, frontier)) {
      latest = frontier;
    }

    return latest;
  }
}

/**
 * Strict forward descendants of `start` in `graph` (excluding `start`).
 *
 * Iterative BFS over the children map; each event is visited at most once.
 */
const collectStrictDescendants = (
  graph: EventGraph,
  start: EventId,
): Set<EventId> => {
  const descendants = new Set<EventId>();
  const stack: EventId[] = [];
  for (const child of graph.iterateChildren(start)) {
    stack.push(child);
  }
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (descendants.has(current)) {
      continue;
    }
    descendants.add(current);
    for (const child of graph.iterateChildren(current)) {
      if (!descendants.has(child)) {
        stack.push(child);
      }
    }
  }
  return descendants;
};
