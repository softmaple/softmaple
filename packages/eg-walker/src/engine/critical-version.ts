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
 * every event outside the version happened after at least one frontier event in
 * the version, and no outside event is concurrent with the version boundary.
 */
export class CriticalVersionAnalyzer {
  isCritical(graph: EventGraph, version: Version): boolean {
    const before = graph.expandVersion(version);
    const allEvents = graph.getAllEvents();

    if (before.size === 0) {
      return allEvents.length === 0;
    }

    for (const event of allEvents) {
      if (before.has(event.id)) {
        continue;
      }

      const hasBoundaryAncestor = Array.from(version).some((frontierId) =>
        graph.isAncestor(frontierId, event.id),
      );
      if (!hasBoundaryAncestor) {
        return false;
      }
    }

    return true;
  }

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
