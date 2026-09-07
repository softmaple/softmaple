import type { CriticalVersionAnalyzer } from "../../engine/critical-version";
import type { ReplayCheckpoint } from "../../engine/partial-replay";
import type { EventGraph } from "../../graph/event-graph";
import type { EventId, Version } from "../../types";
import { PersistentUtf16Rope } from "../../text/persistent-utf16-rope";

export const MAX_RETAINED_CHECKPOINTS = 32;

export type CriticalCheckpoint = ReplayCheckpoint & {
  readonly textBuffer: PersistentUtf16Rope;
  /**
   * Number of events present when this checkpoint was captured.
   *
   * Runtime checkpoints are captured only after the replay planner has proven
   * that the version's ancestor closure is exactly this insertion prefix.
   * Later criticality checks can therefore inspect only events added after the
   * cut instead of expanding the checkpoint's full ancestor closure.
   */
  readonly eventCount: number;
  /** Runtime-only cursor; omitted from native and portable persistence. */
  readonly criticalityValidation?: {
    readonly validatedEventCount: number;
    readonly invalid: boolean;
    readonly requiresFullValidation: boolean;
  };
};

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

  get uniqueTextBytes(): number {
    const seen = new Set<object>();
    return this.checkpoints.reduce(
      (bytes, checkpoint) =>
        bytes + checkpoint.textBuffer.collectUniqueLeafBytes(seen),
      0,
    );
  }

  snapshotForTransaction(): CriticalCheckpointStoreSnapshot {
    return {
      checkpoints: this.checkpoints,
      hits: this.hitCount,
      misses: this.missCount,
    };
  }

  restoreTransaction(snapshot: CriticalCheckpointStoreSnapshot): void {
    this.checkpoints = snapshot.checkpoints;
    this.hitCount = snapshot.hits;
    this.missCount = snapshot.misses;
  }

  toSnapshot(): ReadonlyArray<CriticalCheckpointSnapshot> {
    return this.checkpoints.map((checkpoint) => ({
      version: Array.from(checkpoint.version),
      text: checkpoint.textBuffer.toString(),
      eventCount: checkpoint.eventCount,
    }));
  }

  restore(checkpoints: ReadonlyArray<CriticalCheckpointSnapshot>): void {
    this.checkpoints = checkpoints
      .slice(-MAX_RETAINED_CHECKPOINTS)
      .map((checkpoint) => {
        const version = new Set(checkpoint.version);
        return {
          version,
          textBuffer: PersistentUtf16Rope.from(checkpoint.text),
          eventCount: checkpoint.eventCount,
          criticalityValidation: {
            validatedEventCount: checkpoint.eventCount,
            invalid: false,
            requiresFullValidation: true,
          },
        };
      });
    this.hitCount = 0;
    this.missCount = 0;
  }

  maybeAdvance(
    graph: EventGraph,
    document: string | PersistentUtf16Rope,
  ): void {
    const frontier = graph.getFrontier();
    if (frontier.size !== 1) {
      return;
    }
    // A finite DAG with exactly one frontier has every event causally before
    // that frontier. The singleton frontier is therefore critical by
    // definition, so avoid the analyzer's full ancestor expansion on the
    // sequential hot path.
    this.record(frontier, document, graph.getEventCount());
  }

  /**
   * Record a frontier already proven critical by the replay planner.
   *
   * Unlike {@link maybeAdvance}, this accepts multi-tip frontiers. During a
   * full replay the planner can prove that every remaining event descends
   * from the complete frontier, so retaining its shared rope root is a safe
   * Section 3.5 checkpoint without re-running graph-wide critical analysis.
   */
  record(
    version: Version,
    document: string | PersistentUtf16Rope,
    eventCount: number,
    validatedEventCount: number = eventCount,
  ): CriticalCheckpoint {
    if (
      !Number.isSafeInteger(validatedEventCount) ||
      validatedEventCount < eventCount
    ) {
      throw new Error(
        `Checkpoint validation cursor ${validatedEventCount} precedes cut ${eventCount}`,
      );
    }
    const last = this.checkpoints[this.checkpoints.length - 1];
    if (last && versionsEqual(last.version, version)) {
      const validation = last.criticalityValidation;
      if (
        validation !== undefined &&
        !validation.invalid &&
        !validation.requiresFullValidation
      ) {
        return this.updateValidation(last, {
          ...validation,
          validatedEventCount: Math.max(
            validation.validatedEventCount,
            validatedEventCount,
          ),
        });
      }
      return last;
    }
    const checkpoint: CriticalCheckpoint = {
      version: new Set(version),
      textBuffer:
        typeof document === "string"
          ? PersistentUtf16Rope.from(document)
          : document,
      eventCount,
      criticalityValidation: {
        validatedEventCount,
        invalid: false,
        requiresFullValidation: false,
      },
    };
    this.append(checkpoint);
    return checkpoint;
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
    const validation = candidate.criticalityValidation ?? {
      validatedEventCount: candidate.eventCount,
      invalid: false,
      requiresFullValidation: false,
    };
    if (validation.invalid) {
      return false;
    }

    const eventCount = graph.getEventCount();
    const untrusted = validation.requiresFullValidation;
    if (
      untrusted &&
      graph.expandVersion(candidate.version).size !== candidate.eventCount
    ) {
      this.updateValidation(candidate, { ...validation, invalid: true });
      return false;
    }
    if (
      !graph.isInsertionSuffixDominatedBy(
        candidate.version,
        candidate.eventCount,
        validation.validatedEventCount,
      )
    ) {
      // Native input can contain a valid but redundant (non-frontier)
      // version. Preserve compatibility through the general analyzer while
      // keeping every internally recorded canonical frontier on the cursor
      // path.
      if (untrusted && this.analyzer.isCritical(graph, candidate.version)) {
        this.updateValidation(candidate, {
          ...validation,
          validatedEventCount: eventCount,
        });
        return true;
      }
      this.updateValidation(candidate, { ...validation, invalid: true });
      return false;
    }
    this.updateValidation(candidate, {
      validatedEventCount: eventCount,
      invalid: false,
      requiresFullValidation: false,
    });
    return true;
  }

  /** Copy only changed cursors; transaction snapshots share immutable roots. */
  private updateValidation(
    checkpoint: CriticalCheckpoint,
    validation: NonNullable<CriticalCheckpoint["criticalityValidation"]>,
  ): CriticalCheckpoint {
    const updated = { ...checkpoint, criticalityValidation: validation };
    this.checkpoints = this.checkpoints.map((entry) =>
      entry === checkpoint ? updated : entry,
    );
    return updated;
  }

  private append(checkpoint: CriticalCheckpoint): void {
    const next = [...this.checkpoints, checkpoint];
    this.checkpoints =
      next.length <= MAX_RETAINED_CHECKPOINTS ? next : thinCheckpoints(next);
  }
}

/**
 * Thin the retained ladder instead of keeping the newest cuts.
 *
 * `maybeAdvance` records one checkpoint per incrementally applied event, so a
 * plain "keep the newest `MAX_RETAINED_CHECKPOINTS`" window collapses into 32
 * consecutive cuts: the store ends up covering ~31 events of history and every
 * divergence reaching further back misses and falls into a full replay.
 *
 * Evict the interior cut whose removal costs least instead. Cost is the gap the
 * removal opens, relative to how far that cut sits behind the head: a wide gap
 * deep in history is cheap, the same gap next to the head is not. Repeated
 * application keeps recent cuts dense while old gaps grow geometrically, so a
 * divergence at depth `d` still finds a checkpoint within a small factor of `d`.
 * The oldest and newest entries are never evicted — they anchor the ladder.
 */
const thinCheckpoints = (
  checkpoints: ReadonlyArray<CriticalCheckpoint>,
): ReadonlyArray<CriticalCheckpoint> => {
  const last = checkpoints[checkpoints.length - 1];
  if (checkpoints.length < 3 || last === undefined) {
    return checkpoints.slice(checkpoints.length - MAX_RETAINED_CHECKPOINTS);
  }
  const head = last.eventCount;
  let victim = 1;
  let lowestCost = Number.POSITIVE_INFINITY;
  for (let index = 1; index < checkpoints.length - 1; index++) {
    const previous = checkpoints[index - 1];
    const current = checkpoints[index];
    const following = checkpoints[index + 1];
    if (
      previous === undefined ||
      current === undefined ||
      following === undefined
    ) {
      continue;
    }
    const gap = following.eventCount - previous.eventCount;
    const depth = head - current.eventCount + 1;
    const cost = gap / depth;
    if (cost < lowestCost) {
      lowestCost = cost;
      victim = index;
    }
  }
  return checkpoints.filter((_, index) => index !== victim);
};

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
