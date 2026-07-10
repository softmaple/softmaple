import type { CriticalVersionAnalyzer } from "../../engine/critical-version";
import type { ReplayCheckpoint } from "../../engine/partial-replay";
import type { EventGraph } from "../../graph/event-graph";
import type { EventId } from "../../types";

const MAX_RETAINED_CHECKPOINTS = 32;

export interface CriticalCheckpoint extends ReplayCheckpoint {
  /**
   * Number of events present when this checkpoint was captured.
   *
   * Checkpoints are currently captured only for singleton frontiers, which
   * means every event up to this count is causally included by the checkpoint.
   * Later criticality checks can therefore inspect only events added after this
   * cut point instead of expanding the checkpoint's full ancestor closure.
   */
  readonly eventCount: number;
}

export interface CriticalCheckpointSnapshot {
  readonly version: ReadonlyArray<EventId>;
  readonly text: string;
  readonly eventCount: number;
}

export interface CriticalCheckpointStoreSnapshot {
  readonly checkpoints: ReadonlyArray<CriticalCheckpoint>;
  readonly hits: number;
  readonly misses: number;
}

export class CriticalCheckpointStore {
  private checkpoints: ReadonlyArray<CriticalCheckpoint> = [];
  private hitCount = 0;
  private missCount = 0;

  constructor(private readonly analyzer: CriticalVersionAnalyzer) {}

  get count(): number {
    return this.checkpoints.length;
  }

  /**
   * Cumulative count of {@link pickFor} calls that returned a usable
   * checkpoint (i.e. a previously-recorded critical version dominated the
   * graph's current frontier). Paired with {@link misses} to give benches
   * a direct signal for partial-replay coverage on a given trace.
   */
  get hits(): number {
    return this.hitCount;
  }

  /**
   * Cumulative count of {@link pickFor} calls that returned `null`,
   * forcing the caller (today: `EgWalkerReplica.advanceWithEvent`) into a
   * full replay because no retained checkpoint dominated the divergence.
   */
  get misses(): number {
    return this.missCount;
  }

  snapshotForTransaction(): CriticalCheckpointStoreSnapshot {
    return {
      checkpoints: this.checkpoints.map((checkpoint) => ({
        ...checkpoint,
        version: new Set(checkpoint.version),
      })),
      hits: this.hitCount,
      misses: this.missCount,
    };
  }

  restoreTransaction(snapshot: CriticalCheckpointStoreSnapshot): void {
    this.checkpoints = snapshot.checkpoints.map((checkpoint) => ({
      ...checkpoint,
      version: new Set(checkpoint.version),
    }));
    this.hitCount = snapshot.hits;
    this.missCount = snapshot.misses;
  }

  toSnapshot(): ReadonlyArray<CriticalCheckpointSnapshot> {
    return this.checkpoints.map((checkpoint) => ({
      version: Array.from(checkpoint.version),
      text: checkpoint.text,
      eventCount: checkpoint.eventCount,
    }));
  }

  restore(checkpoints: ReadonlyArray<CriticalCheckpointSnapshot>): void {
    this.checkpoints = checkpoints
      .slice(-MAX_RETAINED_CHECKPOINTS)
      .map((checkpoint) => ({
        version: new Set(checkpoint.version),
        text: checkpoint.text,
        eventCount: checkpoint.eventCount,
      }));
    this.hitCount = 0;
    this.missCount = 0;
  }

  maybeAdvance(graph: EventGraph, document: string): void {
    const frontier = graph.getFrontier();
    if (frontier.size !== 1) {
      return;
    }
    // A finite DAG with exactly one frontier has every event causally before
    // that frontier. The singleton frontier is therefore critical by
    // definition, so avoid the analyzer's full ancestor expansion on the
    // sequential hot path.
    const last = this.checkpoints[this.checkpoints.length - 1];
    if (last && versionsEqual(last.version, frontier)) {
      return;
    }
    this.append({
      version: new Set(frontier),
      text: document,
      eventCount: graph.getEventCount(),
    });
  }

  pickFor(graph: EventGraph): CriticalCheckpoint | null {
    for (let i = this.checkpoints.length - 1; i >= 0; i--) {
      const candidate = this.checkpoints[i];
      if (!candidate) {
        continue;
      }
      if (this.isStillCritical(graph, candidate)) {
        this.hitCount++;
        return candidate;
      }
    }
    this.missCount++;
    return null;
  }

  private isStillCritical(
    graph: EventGraph,
    candidate: CriticalCheckpoint,
  ): boolean {
    if (candidate.version.size !== 1) {
      return this.analyzer.isCritical(graph, candidate.version);
    }

    const [frontierId] = candidate.version;

    const outsideCount = graph.getEventCount() - candidate.eventCount;
    if (outsideCount <= 0) {
      return true;
    }

    let descendantsAfterCheckpoint = 0;
    // The checkpoint frontier was singleton and childless when captured.
    // Therefore every reachable descendant must have been inserted after
    // `candidate.eventCount`; count unique descendants without checking ranks.
    const stack = Array.from(graph.getChildren(frontierId!));
    const visited = new Set<EventId>(stack);

    while (stack.length > 0) {
      const current = stack.pop()!;
      descendantsAfterCheckpoint++;
      if (descendantsAfterCheckpoint === outsideCount) {
        return true;
      }

      for (const child of graph.getChildren(current)) {
        if (!visited.has(child)) {
          visited.add(child);
          stack.push(child);
        }
      }
    }

    return false;
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
