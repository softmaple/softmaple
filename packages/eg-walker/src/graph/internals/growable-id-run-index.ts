import type { EventId } from "../../types";
import { EventAlreadyExistsError } from "../event-graph-errors";
import { canonicalSequenceAfter } from "../event-id";
import type {
  PackedCanonicalIdRun,
  PackedEventIdIndex,
} from "./packed-event-graph-base";

const COLON = 58;
const DIGIT_ZERO = 48;
const DIGIT_NINE = 57;
const MAX_SAFE_SEQUENCE_DIGITS = 16;

interface GrowableIdRun {
  /** Replica prefix of a canonical run, or the whole ID of a custom run. */
  readonly replicaId: string;
  readonly startSequence: number;
  readonly startEventOffset: number;
  length: number;
  readonly custom: boolean;
  /**
   * First sequence of the replica's next run when this run was created.
   * Only the newest run grows, so the bound keeps growth from reaching a
   * sequence that another run already holds.
   */
  readonly sequenceLimit: number;
}

/**
 * Event IDs of a chain that grows at its end, stored as runs.
 *
 * An author typing produces `replicaId:n`, `replicaId:n+1`, and so on. Those
 * IDs extend the newest run in place, so appending one needs no `Map` entry
 * and keeps no ID string. IDs that do not continue the newest run start a new
 * run; IDs that are not canonical `replicaId:sequence` strings get a run of
 * their own. Storage and lookups scale with runs and authors, not events.
 *
 * {@link view} returns an immutable {@link PackedEventIdIndex} over the
 * current prefix. Appending never changes what an earlier view reports.
 * {@link truncate} must not cut below the count of a view that is still in
 * use.
 */
export class GrowableIdRunIndex {
  /** Runs in event-offset order. */
  private readonly runs: GrowableIdRun[] = [];
  /** Canonical runs per replica, ordered by start sequence. */
  private readonly runsByReplica = new Map<string, GrowableIdRun[]>();
  private readonly customOffsets = new Map<EventId, number>();
  private eventCount = 0;
  /** Replica of the previous canonical lookup and its (possibly absent) runs. */
  private lookupReplicaId: string | null = null;
  private lookupRuns: GrowableIdRun[] | undefined;
  /** Run index of the previous offset lookup; linear scans hit it again. */
  private offsetRunHint = 0;

  get count(): number {
    return this.eventCount;
  }

  /**
   * Index `id` at the next event offset.
   *
   * @throws EventAlreadyExistsError when `id` is already indexed. The index
   * is left unchanged.
   */
  append(id: EventId): void {
    const last = this.runs[this.runs.length - 1];
    if (last !== undefined && extendsRun(id, last)) {
      last.length++;
      this.eventCount++;
      return;
    }

    const offset = this.eventCount;
    const colonIndex = id.lastIndexOf(":");
    const sequence = canonicalSequenceAfter(id, colonIndex);
    if (sequence < 0) {
      if (this.customOffsets.has(id)) {
        throw new EventAlreadyExistsError(id);
      }
      this.customOffsets.set(id, offset);
      this.runs.push({
        replicaId: id,
        startSequence: 0,
        startEventOffset: offset,
        length: 1,
        custom: true,
        sequenceLimit: 0,
      });
      this.eventCount++;
      return;
    }

    const replicaId = id.slice(0, colonIndex);
    const replicaRuns = this.runsByReplica.get(replicaId);
    const position =
      replicaRuns === undefined ? 0 : firstRunAfter(replicaRuns, sequence);
    const previous = replicaRuns?.[position - 1];
    if (
      previous !== undefined &&
      sequence < previous.startSequence + previous.length
    ) {
      throw new EventAlreadyExistsError(id);
    }
    const run: GrowableIdRun = {
      replicaId,
      startSequence: sequence,
      startEventOffset: offset,
      length: 1,
      custom: false,
      sequenceLimit:
        replicaRuns?.[position]?.startSequence ?? Number.POSITIVE_INFINITY,
    };
    if (replicaRuns === undefined) {
      this.runsByReplica.set(replicaId, [run]);
      this.lookupReplicaId = null;
    } else {
      replicaRuns.splice(position, 0, run);
    }
    this.runs.push(run);
    this.eventCount++;
  }

  /** Drop every ID at or after `count`. */
  truncate(count: number): void {
    if (!Number.isSafeInteger(count) || count < 0 || count > this.eventCount) {
      throw new Error(
        `Cannot truncate ${this.eventCount} event IDs to ${count}`,
      );
    }
    while (this.runs.length > 0) {
      const last = this.runs[this.runs.length - 1]!;
      if (last.startEventOffset < count) {
        last.length = Math.min(last.length, count - last.startEventOffset);
        break;
      }
      this.runs.pop();
      if (last.custom) {
        this.customOffsets.delete(last.replicaId);
        continue;
      }
      const replicaRuns = this.runsByReplica.get(last.replicaId)!;
      replicaRuns.splice(replicaRuns.lastIndexOf(last), 1);
      if (replicaRuns.length === 0) {
        this.runsByReplica.delete(last.replicaId);
        this.lookupReplicaId = null;
      }
    }
    this.eventCount = count;
    this.offsetRunHint = 0;
  }

  /** An immutable index over the IDs appended so far. */
  view(): PackedEventIdIndex {
    return new GrowableIdRunIndexView(this, this.eventCount);
  }

  /** @internal Offset of `id` among the first `limit` events. */
  offsetBefore(id: EventId, limit: number): number | undefined {
    const colonIndex = id.lastIndexOf(":");
    const sequence = canonicalSequenceAfter(id, colonIndex);
    const offset =
      sequence < 0
        ? this.customOffsets.get(id)
        : canonicalOffset(this.canonicalRunsFor(id, colonIndex), sequence);
    return offset !== undefined && offset < limit ? offset : undefined;
  }

  /** @internal ID at `offset`, or `undefined` outside the first `limit`. */
  idBefore(offset: number, limit: number): EventId | undefined {
    const run = this.runBefore(offset, limit);
    if (run === undefined) {
      return undefined;
    }
    return run.custom
      ? run.replicaId
      : `${run.replicaId}:${run.startSequence + offset - run.startEventOffset}`;
  }

  /** @internal Canonical run holding `offset` among the first `limit`. */
  canonicalRunBefore(
    offset: number,
    limit: number,
  ): PackedCanonicalIdRun | undefined {
    const run = this.runBefore(offset, limit);
    return run === undefined || run.custom ? undefined : run;
  }

  /** @internal IDs of the first `limit` events, in offset order. */
  *idsBefore(limit: number): IterableIterator<EventId> {
    for (const run of this.runs) {
      if (run.startEventOffset >= limit) {
        return;
      }
      if (run.custom) {
        yield run.replicaId;
        continue;
      }
      const end =
        run.startSequence + Math.min(run.length, limit - run.startEventOffset);
      for (let sequence = run.startSequence; sequence < end; sequence++) {
        yield `${run.replicaId}:${sequence}`;
      }
    }
  }

  /** @internal Greatest sequence of `replicaId` among the first `limit`. */
  maximumSequenceBefore(replicaId: string, limit: number): number | undefined {
    const replicaRuns = this.runsByReplica.get(replicaId) ?? [];
    // Runs of one replica never overlap, so the visible run with the greatest
    // start also ends last.
    for (let index = replicaRuns.length - 1; index >= 0; index--) {
      const run = replicaRuns[index]!;
      if (run.startEventOffset < limit) {
        return (
          run.startSequence +
          Math.min(run.length, limit - run.startEventOffset) -
          1
        );
      }
    }
    return undefined;
  }

  private runBefore(offset: number, limit: number): GrowableIdRun | undefined {
    if (!Number.isSafeInteger(offset) || offset < 0 || offset >= limit) {
      return undefined;
    }
    const hinted = this.runs[this.offsetRunHint];
    if (hinted !== undefined && containsOffset(hinted, offset)) {
      return hinted;
    }
    let low = 0;
    let high = this.runs.length - 1;
    while (low <= high) {
      const middle = (low + high) >>> 1;
      const run = this.runs[middle]!;
      if (offset < run.startEventOffset) {
        high = middle - 1;
      } else if (offset >= run.startEventOffset + run.length) {
        low = middle + 1;
      } else {
        this.offsetRunHint = middle;
        return run;
      }
    }
    return undefined;
  }

  /**
   * Resolve a replica's runs without allocating. Lookups tend to repeat one
   * replica, so the previous replica is matched in place before slicing the
   * prefix for the map.
   */
  private canonicalRunsFor(
    id: EventId,
    colonIndex: number,
  ): ReadonlyArray<GrowableIdRun> | undefined {
    const previous = this.lookupReplicaId;
    if (
      previous !== null &&
      previous.length === colonIndex &&
      id.startsWith(previous)
    ) {
      return this.lookupRuns;
    }
    const replicaId = id.slice(0, colonIndex);
    this.lookupReplicaId = replicaId;
    this.lookupRuns = this.runsByReplica.get(replicaId);
    return this.lookupRuns;
  }
}

/** A fixed prefix of a {@link GrowableIdRunIndex}. */
class GrowableIdRunIndexView implements PackedEventIdIndex {
  constructor(
    private readonly index: GrowableIdRunIndex,
    readonly count: number,
  ) {}

  has(id: EventId): boolean {
    return this.index.offsetBefore(id, this.count) !== undefined;
  }

  offsetOf(id: EventId): number | undefined {
    return this.index.offsetBefore(id, this.count);
  }

  idAt(offset: number): EventId | undefined {
    return this.index.idBefore(offset, this.count);
  }

  canonicalRunAt(offset: number): PackedCanonicalIdRun | undefined {
    return this.index.canonicalRunBefore(offset, this.count);
  }

  iterateIds(): IterableIterator<EventId> {
    return this.index.idsBefore(this.count);
  }

  maximumSequenceForReplica(replicaId: string): number | undefined {
    return this.index.maximumSequenceBefore(replicaId, this.count);
  }
}

/**
 * Return whether `id` is exactly `${run.replicaId}:${next}`, where `next` is
 * the sequence after `run`, and the run may grow to hold it. The check parses
 * the suffix before comparing the prefix and allocates nothing.
 */
const extendsRun = (id: EventId, run: GrowableIdRun): boolean => {
  if (run.custom) {
    return false;
  }
  const next = run.startSequence + run.length;
  if (next >= run.sequenceLimit || next > Number.MAX_SAFE_INTEGER) {
    return false;
  }
  const prefixLength = run.replicaId.length;
  const digitsStart = prefixLength + 1;
  const digitCount = id.length - digitsStart;
  if (
    digitCount <= 0 ||
    digitCount > MAX_SAFE_SEQUENCE_DIGITS ||
    id.charCodeAt(prefixLength) !== COLON
  ) {
    return false;
  }
  let codeUnit = id.charCodeAt(digitsStart);
  if (
    codeUnit < DIGIT_ZERO ||
    codeUnit > DIGIT_NINE ||
    (codeUnit === DIGIT_ZERO && digitCount !== 1)
  ) {
    return false;
  }
  let sequence = codeUnit - DIGIT_ZERO;
  for (let index = digitsStart + 1; index < id.length; index++) {
    codeUnit = id.charCodeAt(index);
    if (codeUnit < DIGIT_ZERO || codeUnit > DIGIT_NINE) {
      return false;
    }
    sequence = sequence * 10 + (codeUnit - DIGIT_ZERO);
  }
  return sequence === next && id.startsWith(run.replicaId);
};

const containsOffset = (run: GrowableIdRun, offset: number): boolean =>
  offset >= run.startEventOffset && offset < run.startEventOffset + run.length;

/** Index of the first run whose start sequence is greater than `sequence`. */
const firstRunAfter = (
  runs: ReadonlyArray<GrowableIdRun>,
  sequence: number,
): number => {
  let low = 0;
  let high = runs.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (runs[middle]!.startSequence <= sequence) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
};

const canonicalOffset = (
  runs: ReadonlyArray<GrowableIdRun> | undefined,
  sequence: number,
): number | undefined => {
  if (runs === undefined) {
    return undefined;
  }
  const run = runs[firstRunAfter(runs, sequence) - 1];
  return run !== undefined && sequence < run.startSequence + run.length
    ? run.startEventOffset + sequence - run.startSequence
    : undefined;
};
