import type { EventId } from "../../types";
import { parseEventId } from "../event-id";
import type { PackedEventIdIndex } from "../internals/packed-event-graph-base";
import type { IdRun } from "./types";

/**
 * Run-level ID index for an exact-linear EGW3 graph.
 *
 * The common paper traces contain long canonical ID runs. Keeping those runs
 * intact avoids retaining one string and one `Map` entry per event after a
 * snapshot is decoded. IDs are formatted only when an API consumer asks for
 * them. The auxiliary maps scale with authors/runs, not event count.
 */
export class LazyIdRunIndex implements PackedEventIdIndex {
  readonly count: number;

  private readonly runs: ReadonlyArray<IdRun>;
  private readonly canonicalRunsByReplica: ReadonlyMap<
    string,
    ReadonlyArray<IdRun>
  >;
  private readonly customOffsets: ReadonlyMap<EventId, number>;
  private readonly maximumSequenceByReplica: ReadonlyMap<string, number>;
  private runIndexesByEventOffset: Uint32Array | null = null;

  constructor(runs: ReadonlyArray<IdRun>, expectedCount: number) {
    if (!Number.isSafeInteger(expectedCount) || expectedCount < 0) {
      throw new Error(`Invalid packed event count ${expectedCount}`);
    }

    const canonicalRunsByReplica = new Map<string, IdRun[]>();
    const customOffsets = new Map<EventId, number>();
    let eventOffset = 0;

    for (const [runIndex, run] of runs.entries()) {
      validateRun(run, runIndex, eventOffset);
      Object.freeze(run);
      const endOffset = eventOffset + run.length;
      if (!Number.isSafeInteger(endOffset) || endOffset > expectedCount) {
        throw new Error(`ID run ${runIndex} exceeds the event count`);
      }

      if (run.custom) {
        if (customOffsets.has(run.replicaId)) {
          throw duplicateId(run.replicaId);
        }
        customOffsets.set(run.replicaId, eventOffset);
      } else {
        const endSequence = run.startSequence + run.length - 1;
        if (!Number.isSafeInteger(endSequence)) {
          throw new Error(`ID run ${runIndex} exceeds the safe sequence range`);
        }
        const replicaRuns = canonicalRunsByReplica.get(run.replicaId);
        if (replicaRuns === undefined) {
          canonicalRunsByReplica.set(run.replicaId, [run]);
        } else {
          replicaRuns.push(run);
        }
      }
      eventOffset = endOffset;
    }

    if (eventOffset !== expectedCount) {
      throw new Error(
        `ID runs cover ${eventOffset} events but graph contains ${expectedCount}`,
      );
    }

    const maximumSequenceByReplica = new Map<string, number>();
    for (const [replicaId, replicaRuns] of canonicalRunsByReplica) {
      replicaRuns.sort(
        (left, right) => left.startSequence - right.startSequence,
      );
      let previousEnd = -1;
      for (const run of replicaRuns) {
        if (run.startSequence <= previousEnd) {
          throw duplicateId(`${replicaId}:${run.startSequence}`);
        }
        previousEnd = run.startSequence + run.length - 1;
      }
      maximumSequenceByReplica.set(replicaId, previousEnd);
    }

    // A custom run normally contains a non-canonical ID. Preserve the old
    // decoder's behavior for hand-written payloads that mark a canonical ID
    // as custom, while still detecting collisions with canonical runs.
    for (const id of customOffsets.keys()) {
      const parsed = parseEventId(id);
      if (parsed !== null) {
        if (
          findCanonicalOffset(
            canonicalRunsByReplica.get(parsed.replicaId),
            parsed.sequence,
          ) !== undefined
        ) {
          throw duplicateId(id);
        }
        const currentMaximum = maximumSequenceByReplica.get(parsed.replicaId);
        if (currentMaximum === undefined || parsed.sequence > currentMaximum) {
          maximumSequenceByReplica.set(parsed.replicaId, parsed.sequence);
        }
      }
    }

    this.count = expectedCount;
    this.runs = Object.freeze(runs);
    this.canonicalRunsByReplica = canonicalRunsByReplica;
    this.customOffsets = customOffsets;
    this.maximumSequenceByReplica = maximumSequenceByReplica;
  }

  has(id: EventId): boolean {
    return this.offsetOf(id) !== undefined;
  }

  offsetOf(id: EventId): number | undefined {
    const parsed = parseEventId(id);
    if (parsed !== null) {
      const canonicalOffset = findCanonicalOffset(
        this.canonicalRunsByReplica.get(parsed.replicaId),
        parsed.sequence,
      );
      if (canonicalOffset !== undefined) return canonicalOffset;
    }
    return this.customOffsets.get(id);
  }

  idAt(offset: number): EventId | undefined {
    if (!Number.isSafeInteger(offset) || offset < 0 || offset >= this.count) {
      return undefined;
    }
    const run = findRunAtOffset(this.runs, offset);
    if (run === undefined) return undefined;
    return run.custom
      ? run.replicaId
      : `${run.replicaId}:${run.startSequence + offset - run.startEventOffset}`;
  }

  /** Resolve canonical metadata in O(1) after one lazy packed fill. */
  canonicalRunAt(offset: number): IdRun | undefined {
    if (!Number.isSafeInteger(offset) || offset < 0 || offset >= this.count) {
      return undefined;
    }
    if (this.runIndexesByEventOffset === null) {
      const indexes = new Uint32Array(this.count);
      for (const [runIndex, run] of this.runs.entries()) {
        indexes.fill(
          runIndex,
          run.startEventOffset,
          run.startEventOffset + run.length,
        );
      }
      this.runIndexesByEventOffset = indexes;
    }
    const run = this.runs[this.runIndexesByEventOffset[offset]!]!;
    return run.custom ? undefined : run;
  }

  releaseCanonicalRunLookup(): void {
    this.runIndexesByEventOffset = null;
  }

  *iterateIds(): IterableIterator<EventId> {
    for (const run of this.runs) {
      if (run.custom) {
        yield run.replicaId;
        continue;
      }
      const end = run.startSequence + run.length;
      for (let sequence = run.startSequence; sequence < end; sequence++) {
        yield `${run.replicaId}:${sequence}`;
      }
    }
  }

  maximumSequenceForReplica(replicaId: string): number | undefined {
    return this.maximumSequenceByReplica.get(replicaId);
  }
}

const validateRun = (
  run: IdRun,
  runIndex: number,
  expectedOffset: number,
): void => {
  if (typeof run.replicaId !== "string" || run.replicaId.length === 0) {
    throw new Error(`Invalid event ID in run ${runIndex}`);
  }
  if (
    !Number.isSafeInteger(run.startSequence) ||
    run.startSequence < 0 ||
    !Number.isSafeInteger(run.length) ||
    run.length <= 0 ||
    run.startEventOffset !== expectedOffset
  ) {
    throw new Error(`Invalid ID run ${runIndex}`);
  }
  if (run.custom && run.length !== 1) {
    throw new Error(`Custom id run must have length 1, got ${run.length}`);
  }
};

const findRunAtOffset = (
  runs: ReadonlyArray<IdRun>,
  offset: number,
): IdRun | undefined => {
  let low = 0;
  let high = runs.length - 1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    const run = runs[middle]!;
    if (offset < run.startEventOffset) {
      high = middle - 1;
    } else if (offset >= run.startEventOffset + run.length) {
      low = middle + 1;
    } else {
      return run;
    }
  }
  return undefined;
};

const findCanonicalOffset = (
  runs: ReadonlyArray<IdRun> | undefined,
  sequence: number,
): number | undefined => {
  if (runs === undefined) return undefined;
  let low = 0;
  let high = runs.length - 1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    const run = runs[middle]!;
    if (sequence < run.startSequence) {
      high = middle - 1;
    } else if (sequence >= run.startSequence + run.length) {
      low = middle + 1;
    } else {
      return run.startEventOffset + sequence - run.startSequence;
    }
  }
  return undefined;
};

const duplicateId = (id: EventId): Error =>
  new Error(`Duplicate event ID in columnar graph: ${id}`);
