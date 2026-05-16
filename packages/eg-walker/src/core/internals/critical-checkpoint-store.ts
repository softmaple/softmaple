import type { CriticalVersionAnalyzer } from "../../engine/critical-version";
import type { ReplayCheckpoint } from "../../engine/partial-replay";
import type { EventGraph } from "../../graph/event-graph";
import type { EventId } from "../../types";

const MAX_RETAINED_CHECKPOINTS = 32;

export type CriticalCheckpoint = ReplayCheckpoint;

export class CriticalCheckpointStore {
  private checkpoints: ReadonlyArray<CriticalCheckpoint> = [];

  constructor(private readonly analyzer: CriticalVersionAnalyzer) {}

  get count(): number {
    return this.checkpoints.length;
  }

  maybeAdvance(graph: EventGraph, document: string): void {
    const frontier = graph.getFrontier();
    if (frontier.size !== 1) {
      return;
    }
    if (!this.analyzer.isCritical(graph, frontier)) {
      return;
    }
    const last = this.checkpoints[this.checkpoints.length - 1];
    if (last && versionsEqual(last.version, frontier)) {
      return;
    }
    this.append({
      version: new Set(frontier),
      text: document,
    });
  }

  pickFor(graph: EventGraph): CriticalCheckpoint | null {
    for (let i = this.checkpoints.length - 1; i >= 0; i--) {
      const candidate = this.checkpoints[i];
      if (!candidate) {
        continue;
      }
      if (this.analyzer.isCritical(graph, candidate.version)) {
        return candidate;
      }
    }
    return null;
  }

  private append(checkpoint: CriticalCheckpoint): void {
    const next = [...this.checkpoints, checkpoint];
    this.checkpoints =
      next.length <= MAX_RETAINED_CHECKPOINTS
        ? next
        : next.slice(next.length - MAX_RETAINED_CHECKPOINTS);
  }
}

const versionsEqual = (
  left: ReadonlySet<EventId>,
  right: ReadonlySet<EventId>,
): boolean => {
  if (left.size !== right.size) {
    return false;
  }
  for (const id of left) {
    if (!right.has(id)) {
      return false;
    }
  }
  return true;
};
