import type { EventId } from "../../types";
import type { IdRun } from "../columnar-codec/types";
import { EventAlreadyExistsError } from "../event-graph-errors";
import { canonicalSequenceAfter } from "../event-id";
import { AgentTable } from "./agent-table";

/** Agent of an event whose ID is not a canonical `replicaId:sequence`. */
export const CUSTOM_AGENT = -1;

/** Build the dense offset lookup only once binary search has work to do. */
const MIN_RUNS_FOR_DENSE_LOOKUP = 64;

/** Canonical ID interval, as the EGW3 run index and replay planners see it. */
export interface PackedCanonicalIdRun {
  readonly replicaId: string;
  readonly startSequence: number;
  readonly startEventOffset: number;
  readonly length: number;
}

/**
 * Event IDs of the local versions `[startEventOffset, startEventOffset +
 * length)`.
 *
 * A canonical run holds `replicaId:startSequence` and the IDs after it. A
 * custom run holds one ID verbatim in `replicaId`. When that ID still parses
 * as `replica:sequence` (only hand-written EGW3 payloads mark such an ID
 * custom), `agent` and `startSequence` hold the parsed parts, so the event
 * orders and coalesces exactly like its canonical twin would.
 */
interface EventIdRun extends PackedCanonicalIdRun {
  length: number;
  readonly custom: boolean;
  readonly agent: number;
  /**
   * First sequence of the agent's next run while this run can still grow.
   * Only the newest run grows, so the bound keeps growth from reaching a
   * sequence that another run already holds.
   */
  sequenceLimit: number;
}

/**
 * Event IDs by local version, stored as runs.
 *
 * Local versions are dense offsets: the `n`th indexed event has local version
 * `n`. An author typing produces `replicaId:n`, `replicaId:n+1`, and so on;
 * those IDs extend the newest run in place, so indexing one needs no `Map`
 * entry and keeps no ID string. Storage and lookups scale with runs and
 * agents, not events.
 *
 * Canonical replica IDs are numbered by a shared {@link AgentTable}, so
 * callers compare and group events by `(agent, sequence)` without parsing or
 * formatting IDs. IDs are formatted only when a caller asks for one.
 *
 * {@link view} returns an immutable prefix. Appending never changes what an
 * earlier view reports; {@link truncate} must not cut below the count of a
 * view that is still in use.
 */
export class EventIdRunIndex {
  readonly agents: AgentTable;
  /** Runs in local-version order. */
  private readonly runs: EventIdRun[] = [];
  /** Canonical runs of each agent, ordered by start sequence. */
  private readonly runsByAgent: EventIdRun[][] = [];
  private readonly customOffsets = new Map<EventId, number>();
  /** Custom runs whose ID parses canonically; hand-written payloads only. */
  private parsedCustomRuns: EventIdRun[] | null = null;
  private eventCount = 0;
  /** Run index of the previous offset lookup; linear scans hit it again. */
  private offsetRunHint = 0;
  /** Run index per local version, built for random access during replay. */
  private runIndexByOffset: Uint32Array | null = null;

  constructor(agents: AgentTable = new AgentTable()) {
    this.agents = agents;
  }

  /**
   * Validate and index the ID runs of an EGW3 payload.
   *
   * Runs must cover `[0, expectedCount)` in order. Duplicate IDs are
   * rejected, including a custom ID that repeats a canonical one.
   */
  static fromRuns(
    runs: ReadonlyArray<IdRun>,
    expectedCount: number,
    agents?: AgentTable,
  ): EventIdRunIndex {
    if (!Number.isSafeInteger(expectedCount) || expectedCount < 0) {
      throw new Error(`Invalid packed event count ${expectedCount}`);
    }
    const index = new EventIdRunIndex(agents);
    let eventOffset = 0;
    for (const [runIndex, run] of runs.entries()) {
      validateRun(run, runIndex, eventOffset);
      const endOffset = eventOffset + run.length;
      if (!Number.isSafeInteger(endOffset) || endOffset > expectedCount) {
        throw new Error(`ID run ${runIndex} exceeds the event count`);
      }
      if (run.custom === true) {
        if (index.customOffsets.has(run.replicaId)) {
          throw duplicateColumnarId(run.replicaId);
        }
        index.pushCustomRun(run.replicaId, eventOffset);
      } else {
        const endSequence = run.startSequence + run.length - 1;
        if (!Number.isSafeInteger(endSequence)) {
          throw new Error(`ID run ${runIndex} exceeds the safe sequence range`);
        }
        const indexed: EventIdRun = {
          replicaId: run.replicaId,
          startSequence: run.startSequence,
          startEventOffset: eventOffset,
          length: run.length,
          custom: false,
          agent: index.agents.intern(run.replicaId),
          sequenceLimit: Number.POSITIVE_INFINITY,
        };
        index.runs.push(indexed);
        index.agentRunList(indexed.agent).push(indexed);
      }
      eventOffset = endOffset;
    }
    if (eventOffset !== expectedCount) {
      throw new Error(
        `ID runs cover ${eventOffset} events but graph contains ${expectedCount}`,
      );
    }
    index.eventCount = eventOffset;

    for (const agentRuns of index.runsByAgent) {
      if (agentRuns === undefined || agentRuns.length < 2) {
        continue;
      }
      if (!isSortedBySequence(agentRuns)) {
        agentRuns.sort(
          (left, right) => left.startSequence - right.startSequence,
        );
      }
      for (let position = 1; position < agentRuns.length; position++) {
        const previous = agentRuns[position - 1]!;
        const run = agentRuns[position]!;
        if (run.startSequence < previous.startSequence + previous.length) {
          throw duplicateColumnarId(`${run.replicaId}:${run.startSequence}`);
        }
        previous.sequenceLimit = run.startSequence;
      }
    }

    // A custom run normally contains a non-canonical ID. Hand-written
    // payloads may mark a canonical ID as custom; it must still not repeat
    // an ID that a canonical run holds.
    for (const run of index.parsedCustomRuns ?? []) {
      if (
        canonicalOffset(index.runsByAgent[run.agent], run.startSequence) !==
        undefined
      ) {
        throw duplicateColumnarId(run.replicaId);
      }
    }
    return index;
  }

  get count(): number {
    return this.eventCount;
  }

  get runCount(): number {
    return this.runs.length;
  }

  /** Whether any indexed event has a custom (verbatim) ID. */
  hasCustomIds(): boolean {
    return this.customOffsets.size > 0;
  }

  /**
   * Index `id` at the next local version and return that version.
   *
   * @throws EventAlreadyExistsError when `id` is already indexed. The index
   * is left unchanged.
   */
  append(id: EventId): number {
    const offset = this.eventCount;
    const last = this.runs[this.runs.length - 1];
    if (last !== undefined && extendsRun(id, last)) {
      last.length++;
      this.eventCount++;
      return offset;
    }

    const colonIndex = id.lastIndexOf(":");
    const sequence = canonicalSequenceAfter(id, colonIndex);
    if (sequence < 0) {
      if (this.customOffsets.has(id)) {
        throw new EventAlreadyExistsError(id);
      }
      this.pushCustomRun(id, offset);
      this.eventCount++;
      return offset;
    }
    const agent = this.agents.internPrefix(id, colonIndex);
    this.appendCanonicalRun(agent, sequence, id);
    return offset;
  }

  /**
   * Index the canonical ID `(agent, sequence)` at the next local version.
   *
   * @throws EventAlreadyExistsError when the ID is already indexed.
   */
  appendCanonical(agent: number, sequence: number): number {
    const offset = this.eventCount;
    const last = this.runs[this.runs.length - 1];
    if (
      last !== undefined &&
      !last.custom &&
      last.agent === agent &&
      last.startSequence + last.length === sequence &&
      sequence < last.sequenceLimit
    ) {
      last.length++;
      this.eventCount++;
      return offset;
    }
    this.appendCanonicalRun(agent, sequence, null);
    return offset;
  }

  /** Drop every ID at or after `count`. */
  truncate(count: number): void {
    if (!Number.isSafeInteger(count) || count < 0 || count > this.eventCount) {
      throw new Error(
        `Cannot truncate ${this.eventCount} event IDs to ${count}`,
      );
    }
    let removedParsedCustom = false;
    while (this.runs.length > 0) {
      const last = this.runs[this.runs.length - 1]!;
      if (last.startEventOffset < count) {
        last.length = Math.min(last.length, count - last.startEventOffset);
        break;
      }
      this.runs.pop();
      if (last.custom) {
        this.customOffsets.delete(last.replicaId);
        removedParsedCustom ||= last.agent !== CUSTOM_AGENT;
        continue;
      }
      const agentRuns = this.runsByAgent[last.agent]!;
      agentRuns.splice(agentRuns.lastIndexOf(last), 1);
    }
    if (removedParsedCustom) {
      this.parsedCustomRuns =
        this.parsedCustomRuns?.filter((run) => run.startEventOffset < count) ??
        null;
    }
    this.eventCount = count;
    this.offsetRunHint = 0;
    this.runIndexByOffset = null;
  }

  /** An immutable index over the IDs indexed so far. */
  view(): EventIdRunIndexView {
    return new EventIdRunIndexView(this, this.eventCount);
  }

  /** Local version of `id` below `limit`, or `-1`. */
  localVersionOf(id: EventId, limit: number = this.eventCount): number {
    const colonIndex = id.lastIndexOf(":");
    const sequence = canonicalSequenceAfter(id, colonIndex);
    if (sequence >= 0) {
      const agent = this.agents.resolvePrefix(id, colonIndex);
      if (agent >= 0) {
        const offset = canonicalOffset(this.runsByAgent[agent], sequence);
        if (offset !== undefined) {
          return offset < limit ? offset : -1;
        }
      }
    }
    const custom = this.customOffsets.get(id);
    return custom !== undefined && custom < limit ? custom : -1;
  }

  /** Local version of a custom (verbatim) ID below `limit`, or `-1`. */
  localVersionOfCustom(id: EventId, limit: number = this.eventCount): number {
    const offset = this.customOffsets.get(id);
    return offset !== undefined && offset < limit ? offset : -1;
  }

  /** Local version of the canonical ID `(agent, sequence)`, or `-1`. */
  localVersionOfCanonical(
    agent: number,
    sequence: number,
    limit: number = this.eventCount,
  ): number {
    const offset = canonicalOffset(this.runsByAgent[agent], sequence);
    return offset !== undefined && offset < limit ? offset : -1;
  }

  /** ID at `offset`, or `undefined` outside the first `limit` events. */
  idAt(offset: number, limit: number = this.eventCount): EventId | undefined {
    const run = this.runBefore(offset, limit);
    if (run === undefined) {
      return undefined;
    }
    return run.custom
      ? run.replicaId
      : `${run.replicaId}:${run.startSequence + offset - run.startEventOffset}`;
  }

  /**
   * Agent of the event at `offset`, or {@link CUSTOM_AGENT} when its ID does
   * not parse as `replicaId:sequence`.
   */
  agentAt(offset: number): number {
    return this.requireRun(offset).agent;
  }

  /** Sequence of the event at `offset`; meaningful for canonical agents. */
  sequenceAt(offset: number): number {
    const run = this.requireRun(offset);
    return run.custom
      ? run.startSequence
      : run.startSequence + offset - run.startEventOffset;
  }

  /** Whether the event at `offset` has a custom (verbatim) ID. */
  isCustomAt(offset: number): boolean {
    return this.requireRun(offset).custom;
  }

  /** Canonical run holding `offset` among the first `limit`. */
  canonicalRunAt(
    offset: number,
    limit: number = this.eventCount,
  ): PackedCanonicalIdRun | undefined {
    const run = this.runBefore(offset, limit);
    return run === undefined || run.custom ? undefined : run;
  }

  /**
   * Local versions after `offset` that hold consecutive sequences of the same
   * agent, up to `maximum`, stopping at `limit`: the length of the canonical
   * run through `offset`, measured from it.
   */
  canonicalRunLengthFrom(offset: number, limit: number): number {
    const run = this.runBefore(offset, limit);
    if (run === undefined || run.custom) {
      return 0;
    }
    return Math.min(run.startEventOffset + run.length, limit) - offset;
  }

  /** IDs of the first `limit` events, in local-version order. */
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

  /** Greatest sequence of `replicaId` among the first `limit` events. */
  maximumSequenceBefore(replicaId: string, limit: number): number | undefined {
    const agent = this.agents.numberOf(replicaId);
    let maximum: number | undefined;
    const agentRuns = agent < 0 ? undefined : this.runsByAgent[agent];
    if (agentRuns !== undefined) {
      // Runs of one agent never overlap, so the visible run with the greatest
      // start also ends last.
      for (let index = agentRuns.length - 1; index >= 0; index--) {
        const run = agentRuns[index]!;
        if (run.startEventOffset < limit) {
          maximum =
            run.startSequence +
            Math.min(run.length, limit - run.startEventOffset) -
            1;
          break;
        }
      }
    }
    for (const run of this.parsedCustomRuns ?? []) {
      if (
        run.agent === agent &&
        run.startEventOffset < limit &&
        (maximum === undefined || run.startSequence > maximum)
      ) {
        maximum = run.startSequence;
      }
    }
    return maximum;
  }

  /**
   * Build the offset-to-run table that random access by local version uses.
   * Replay planners call this before walking events out of order; it is
   * dropped again by {@link releaseRunLookup} or any truncation.
   */
  ensureRunLookup(): void {
    if (
      this.runs.length < MIN_RUNS_FOR_DENSE_LOOKUP ||
      (this.runIndexByOffset !== null &&
        this.runIndexByOffset.length === this.eventCount)
    ) {
      return;
    }
    const lookup = new Uint32Array(this.eventCount);
    for (let runIndex = 0; runIndex < this.runs.length; runIndex++) {
      const run = this.runs[runIndex]!;
      lookup.fill(
        runIndex,
        run.startEventOffset,
        run.startEventOffset + run.length,
      );
    }
    this.runIndexByOffset = lookup;
  }

  releaseRunLookup(): void {
    this.runIndexByOffset = null;
  }

  private appendCanonicalRun(
    agent: number,
    sequence: number,
    id: EventId | null,
  ): void {
    const agentRuns = this.agentRunList(agent);
    const position = firstRunAfter(agentRuns, sequence);
    const previous = agentRuns[position - 1];
    if (
      previous !== undefined &&
      sequence < previous.startSequence + previous.length
    ) {
      throw new EventAlreadyExistsError(
        id ?? `${this.agents.nameOf(agent)}:${sequence}`,
      );
    }
    const run: EventIdRun = {
      replicaId: this.agents.nameOf(agent),
      startSequence: sequence,
      startEventOffset: this.eventCount,
      length: 1,
      custom: false,
      agent,
      sequenceLimit:
        agentRuns[position]?.startSequence ?? Number.POSITIVE_INFINITY,
    };
    agentRuns.splice(position, 0, run);
    this.runs.push(run);
    this.eventCount++;
  }

  private pushCustomRun(id: EventId, offset: number): void {
    const colonIndex = id.lastIndexOf(":");
    const sequence = canonicalSequenceAfter(id, colonIndex);
    const agent =
      sequence < 0 ? CUSTOM_AGENT : this.agents.internPrefix(id, colonIndex);
    const run: EventIdRun = {
      replicaId: id,
      startSequence: sequence < 0 ? 0 : sequence,
      startEventOffset: offset,
      length: 1,
      custom: true,
      agent,
      sequenceLimit: 0,
    };
    this.customOffsets.set(id, offset);
    this.runs.push(run);
    if (agent !== CUSTOM_AGENT) {
      (this.parsedCustomRuns ??= []).push(run);
    }
  }

  private agentRunList(agent: number): EventIdRun[] {
    let agentRuns = this.runsByAgent[agent];
    if (agentRuns === undefined) {
      agentRuns = [];
      this.runsByAgent[agent] = agentRuns;
    }
    return agentRuns;
  }

  private requireRun(offset: number): EventIdRun {
    const run = this.runBefore(offset, this.eventCount);
    if (run === undefined) {
      throw new RangeError(`Event ID index has no local version ${offset}`);
    }
    return run;
  }

  private runBefore(offset: number, limit: number): EventIdRun | undefined {
    if (!Number.isSafeInteger(offset) || offset < 0 || offset >= limit) {
      return undefined;
    }
    const lookup = this.runIndexByOffset;
    if (lookup !== null && offset < lookup.length) {
      return this.runs[lookup[offset]!];
    }
    const hinted = this.runs[this.offsetRunHint];
    if (hinted !== undefined && containsOffset(hinted, offset)) {
      return hinted;
    }
    const next = this.runs[this.offsetRunHint + 1];
    if (next !== undefined && containsOffset(next, offset)) {
      this.offsetRunHint++;
      return next;
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
}

/** A fixed prefix of an {@link EventIdRunIndex}. */
export class EventIdRunIndexView {
  constructor(
    private readonly index: EventIdRunIndex,
    readonly count: number,
  ) {}

  get agents(): AgentTable {
    return this.index.agents;
  }

  has(id: EventId): boolean {
    return this.index.localVersionOf(id, this.count) >= 0;
  }

  offsetOf(id: EventId): number | undefined {
    const offset = this.index.localVersionOf(id, this.count);
    return offset < 0 ? undefined : offset;
  }

  offsetOfCanonical(agent: number, sequence: number): number {
    return this.index.localVersionOfCanonical(agent, sequence, this.count);
  }

  hasCustomIds(): boolean {
    return this.index.hasCustomIds();
  }

  idAt(offset: number): EventId | undefined {
    return this.index.idAt(offset, this.count);
  }

  agentAt(offset: number): number {
    this.assertOffset(offset);
    return this.index.agentAt(offset);
  }

  sequenceAt(offset: number): number {
    this.assertOffset(offset);
    return this.index.sequenceAt(offset);
  }

  isCustomAt(offset: number): boolean {
    this.assertOffset(offset);
    return this.index.isCustomAt(offset);
  }

  canonicalRunAt(offset: number): PackedCanonicalIdRun | undefined {
    return this.index.canonicalRunAt(offset, this.count);
  }

  canonicalRunLengthFrom(offset: number): number {
    return this.index.canonicalRunLengthFrom(offset, this.count);
  }

  ensureRunLookup(): void {
    this.index.ensureRunLookup();
  }

  releaseCanonicalRunLookup(): void {
    this.index.releaseRunLookup();
  }

  iterateIds(): IterableIterator<EventId> {
    return this.index.idsBefore(this.count);
  }

  maximumSequenceForReplica(replicaId: string): number | undefined {
    return this.index.maximumSequenceBefore(replicaId, this.count);
  }

  private assertOffset(offset: number): void {
    if (!Number.isSafeInteger(offset) || offset < 0 || offset >= this.count) {
      throw new RangeError(`Event ID index has no local version ${offset}`);
    }
  }
}

const COLON = 58;
const DIGIT_ZERO = 48;
const DIGIT_NINE = 57;
const MAX_SAFE_SEQUENCE_DIGITS = 16;

/**
 * Return whether `id` is exactly `${run.replicaId}:${next}`, where `next` is
 * the sequence after `run`, and the run may grow to hold it. The check parses
 * the suffix before comparing the prefix and allocates nothing.
 */
const extendsRun = (id: EventId, run: EventIdRun): boolean => {
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

const containsOffset = (run: EventIdRun, offset: number): boolean =>
  offset >= run.startEventOffset && offset < run.startEventOffset + run.length;

/** Index of the first run whose start sequence is greater than `sequence`. */
const firstRunAfter = (
  runs: ReadonlyArray<EventIdRun>,
  sequence: number,
): number => {
  let low = 0;
  let high = runs.length;
  // Appends almost always extend an agent's sequence.
  const last = runs[high - 1];
  if (last !== undefined && last.startSequence <= sequence) {
    return high;
  }
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
  runs: ReadonlyArray<EventIdRun> | undefined,
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

const isSortedBySequence = (runs: ReadonlyArray<EventIdRun>): boolean => {
  for (let index = 1; index < runs.length; index++) {
    if (runs[index]!.startSequence < runs[index - 1]!.startSequence) {
      return false;
    }
  }
  return true;
};

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
  if (run.custom === true && run.length !== 1) {
    throw new Error(`Custom id run must have length 1, got ${run.length}`);
  }
};

const duplicateColumnarId = (id: EventId): Error =>
  new Error(`Duplicate event ID in columnar graph: ${id}`);
