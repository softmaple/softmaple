import type { EventId } from "../../types";
import type { GraphRuns } from "./graph-runs";

const DIFF_COLOR = {
  LEFT: 1,
  RIGHT: 2,
  COMMON: 3,
} as const;

const INITIAL_WORKSPACE_CAPACITY = 64;

export interface PackedDiffVersionsView {
  readonly count: number;
  readonly runs: GraphRuns;
  offsetOf(id: EventId): number | undefined;
  idAt(offset: number): EventId | undefined;
  parentCountAt(offset: number): number;
  parentOffsetAt(offset: number, parentIndex: number): number | undefined;
}

export interface PackedVersionDiff {
  readonly onlyInLeft: Set<EventId>;
  readonly onlyInRight: Set<EventId>;
}

/**
 * Ephemeral, allocation-free transition over packed event offsets.
 *
 * Only the prefixes selected by `retreatCount` and `advanceCount` are valid.
 * The arrays and this view are owned by a reusable workspace and are
 * overwritten by its next query. Retreat offsets are in descending local
 * version; advance offsets are in ascending local version.
 */
export interface PackedOffsetTransition {
  readonly retreatOffsets: Uint32Array;
  readonly retreatCount: number;
  readonly advanceOffsets: Uint32Array;
  readonly advanceCount: number;
}

/**
 * Ephemeral run-length encoded transition over packed local versions.
 *
 * Each range is half-open (`[start, end)`). Retreat ranges expand from
 * `end - 1` down to `start`; advance ranges expand from `start` up to
 * `end - 1`. Only prefixes selected by the corresponding range counts are
 * valid. The buffers and this view are workspace-owned and are overwritten by
 * the workspace's next query.
 */
export interface PackedLocalVersionTransition {
  readonly retreatStarts: Uint32Array;
  readonly retreatEnds: Uint32Array;
  readonly retreatRangeCount: number;
  readonly retreatEventCount: number;
  readonly advanceStarts: Uint32Array;
  readonly advanceEnds: Uint32Array;
  readonly advanceRangeCount: number;
  readonly advanceEventCount: number;
}

/**
 * Reusable numeric workspace for Appendix B's version diff.
 *
 * Packed insertion offsets are local versions and already a valid
 * topological rank, so the traversal needs neither string-keyed colour maps
 * nor a heap with a comparator closure. It walks the graph's runs rather than
 * its events: a transition across a long branch costs one step per run, not
 * one per event. Colours live in one byte per packed event; the heap,
 * touched-offset list and transition outputs grow only to the largest
 * divergent region observed by this immutable graph and are reused by
 * subsequent diffs.
 */
export class PackedDiffVersionsWorkspace
  implements PackedOffsetTransition, PackedLocalVersionTransition
{
  private readonly colors: Uint8Array;
  private heap: Uint32Array;
  private heapLength = 0;
  private touched: Uint32Array;
  private touchedLength = 0;
  private retreatBuffer: Uint32Array;
  private retreatLength = 0;
  private advanceBuffer: Uint32Array;
  private advanceLength = 0;
  private retreatStartBuffer: Uint32Array;
  private retreatEndBuffer: Uint32Array;
  private retreatRangeLength = 0;
  private retreatRangeEventLength = 0;
  private advanceStartBuffer: Uint32Array;
  private advanceEndBuffer: Uint32Array;
  private advanceRangeLength = 0;
  private advanceRangeEventLength = 0;
  private scalarOffsetWrites = 0;
  private active = false;

  constructor(private readonly eventCount: number) {
    this.colors = new Uint8Array(eventCount);
    const initialCapacity = Math.min(eventCount, INITIAL_WORKSPACE_CAPACITY);
    this.heap = new Uint32Array(initialCapacity);
    this.touched = new Uint32Array(initialCapacity);
    this.retreatBuffer = new Uint32Array(initialCapacity);
    this.advanceBuffer = new Uint32Array(initialCapacity);
    this.retreatStartBuffer = new Uint32Array(initialCapacity);
    this.retreatEndBuffer = new Uint32Array(initialCapacity);
    this.advanceStartBuffer = new Uint32Array(initialCapacity);
    this.advanceEndBuffer = new Uint32Array(initialCapacity);
  }

  get retreatOffsets(): Uint32Array {
    return this.retreatBuffer;
  }

  get retreatCount(): number {
    return this.retreatLength;
  }

  get advanceOffsets(): Uint32Array {
    return this.advanceBuffer;
  }

  get advanceCount(): number {
    return this.advanceLength;
  }

  get retreatStarts(): Uint32Array {
    return this.retreatStartBuffer;
  }

  get retreatEnds(): Uint32Array {
    return this.retreatEndBuffer;
  }

  get retreatRangeCount(): number {
    return this.retreatRangeLength;
  }

  get retreatEventCount(): number {
    return this.retreatRangeEventLength;
  }

  get advanceStarts(): Uint32Array {
    return this.advanceStartBuffer;
  }

  get advanceEnds(): Uint32Array {
    return this.advanceEndBuffer;
  }

  get advanceRangeCount(): number {
    return this.advanceRangeLength;
  }

  get advanceEventCount(): number {
    return this.advanceRangeEventLength;
  }

  /** @internal Structural diagnostic for tests and replay benchmarks. */
  get scalarOffsetWriteCount(): number {
    return this.scalarOffsetWrites;
  }

  diff(
    left: ReadonlySet<EventId>,
    right: ReadonlySet<EventId>,
    view: PackedDiffVersionsView,
  ): PackedVersionDiff {
    // Public callers can supply custom Set subclasses whose iterator invokes
    // diffVersions recursively. Keep the common path allocation-light while
    // preserving correctness for that unusual re-entrant case.
    if (this.active) {
      return new PackedDiffVersionsWorkspace(this.eventCount).diff(
        left,
        right,
        view,
      );
    }

    this.begin();
    try {
      let pendingDivergent = this.paintVersion(left, DIFF_COLOR.LEFT, view);
      pendingDivergent += this.paintVersion(right, DIFF_COLOR.RIGHT, view);
      this.collectTransition(pendingDivergent, view);

      const onlyInLeft = new Set<EventId>();
      for (let index = 0; index < this.retreatLength; index++) {
        onlyInLeft.add(this.requireId(view, this.retreatBuffer[index]!));
      }
      // The historical public implementation inserted right-side IDs in
      // descending topological order. The numeric transition exposes advance
      // offsets in ascending order, so iterate it backwards here to preserve
      // the public Set's observable insertion order as well as its contents.
      const onlyInRight = new Set<EventId>();
      for (let index = this.advanceLength - 1; index >= 0; index--) {
        onlyInRight.add(this.requireId(view, this.advanceBuffer[index]!));
      }
      return { onlyInLeft, onlyInRight };
    } finally {
      this.finish();
    }
  }

  /**
   * Diff an ID frontier against the direct parent version of one packed event.
   */
  diffVersionToParents(
    currentVersion: ReadonlySet<EventId>,
    targetEventOffset: number,
    view: PackedDiffVersionsView,
  ): PackedOffsetTransition {
    if (this.active) {
      return new PackedDiffVersionsWorkspace(
        this.eventCount,
      ).diffVersionToParents(currentVersion, targetEventOffset, view);
    }

    this.assertEventOffset(targetEventOffset);
    this.begin();
    try {
      let pendingDivergent = this.paintVersion(
        currentVersion,
        DIFF_COLOR.LEFT,
        view,
      );
      pendingDivergent += this.paintParents(
        targetEventOffset,
        DIFF_COLOR.RIGHT,
        view,
      );
      this.collectTransition(pendingDivergent, view);
      return this;
    } finally {
      this.finish();
    }
  }

  /**
   * Diff an ID frontier against one event's parents as local-version ranges.
   */
  diffVersionToParentRanges(
    currentVersion: ReadonlySet<EventId>,
    targetEventOffset: number,
    view: PackedDiffVersionsView,
  ): PackedLocalVersionTransition {
    if (this.active) {
      return new PackedDiffVersionsWorkspace(
        this.eventCount,
      ).diffVersionToParentRanges(currentVersion, targetEventOffset, view);
    }

    this.assertEventOffset(targetEventOffset);
    this.begin();
    try {
      let pendingDivergent = this.paintVersion(
        currentVersion,
        DIFF_COLOR.LEFT,
        view,
      );
      pendingDivergent += this.paintParents(
        targetEventOffset,
        DIFF_COLOR.RIGHT,
        view,
      );
      this.collectRangeTransition(pendingDivergent, view);
      return this;
    } finally {
      this.finish();
    }
  }

  /**
   * Diff a version given as packed offsets (local versions) against one
   * event's parents as local-version ranges.
   */
  diffLocalVersionsToParentRanges(
    currentOffsets: ReadonlyArray<number>,
    targetEventOffset: number,
    view: PackedDiffVersionsView,
  ): PackedLocalVersionTransition {
    if (this.active) {
      return new PackedDiffVersionsWorkspace(
        this.eventCount,
      ).diffLocalVersionsToParentRanges(
        currentOffsets,
        targetEventOffset,
        view,
      );
    }

    this.assertEventOffset(targetEventOffset);
    for (const offset of currentOffsets) {
      this.assertEventOffset(offset);
    }
    this.begin();
    try {
      let pendingDivergent = 0;
      for (const offset of currentOffsets) {
        pendingDivergent += this.paint(offset, DIFF_COLOR.LEFT);
      }
      pendingDivergent += this.paintParents(
        targetEventOffset,
        DIFF_COLOR.RIGHT,
        view,
      );
      this.collectRangeTransition(pendingDivergent, view);
      return this;
    } finally {
      this.finish();
    }
  }

  /**
   * Diff a singleton packed version against one event's direct parent version.
   */
  diffOffsetToParents(
    currentOffset: number,
    targetEventOffset: number,
    view: PackedDiffVersionsView,
  ): PackedOffsetTransition {
    if (this.active) {
      return new PackedDiffVersionsWorkspace(
        this.eventCount,
      ).diffOffsetToParents(currentOffset, targetEventOffset, view);
    }

    this.assertEventOffset(currentOffset);
    this.assertEventOffset(targetEventOffset);
    this.begin();
    try {
      let pendingDivergent = this.paint(currentOffset, DIFF_COLOR.LEFT);
      pendingDivergent += this.paintParents(
        targetEventOffset,
        DIFF_COLOR.RIGHT,
        view,
      );
      this.collectTransition(pendingDivergent, view);
      return this;
    } finally {
      this.finish();
    }
  }

  /**
   * Diff one packed event against another event's parents as local-version
   * ranges.
   */
  diffOffsetToParentRanges(
    currentOffset: number,
    targetEventOffset: number,
    view: PackedDiffVersionsView,
  ): PackedLocalVersionTransition {
    if (this.active) {
      return new PackedDiffVersionsWorkspace(
        this.eventCount,
      ).diffOffsetToParentRanges(currentOffset, targetEventOffset, view);
    }

    this.assertEventOffset(currentOffset);
    this.assertEventOffset(targetEventOffset);
    this.begin();
    try {
      let pendingDivergent = this.paint(currentOffset, DIFF_COLOR.LEFT);
      pendingDivergent += this.paintParents(
        targetEventOffset,
        DIFF_COLOR.RIGHT,
        view,
      );
      this.collectRangeTransition(pendingDivergent, view);
      return this;
    } finally {
      this.finish();
    }
  }

  private begin(): void {
    this.active = true;
    this.retreatLength = 0;
    this.advanceLength = 0;
    this.retreatRangeLength = 0;
    this.retreatRangeEventLength = 0;
    this.advanceRangeLength = 0;
    this.advanceRangeEventLength = 0;
    this.scalarOffsetWrites = 0;
  }

  private ensureRetreatRangeCapacity(required: number): void {
    if (required <= this.retreatStartBuffer.length) {
      return;
    }
    this.retreatStartBuffer = this.ensureCapacity(
      this.retreatStartBuffer,
      required,
    );
    this.retreatEndBuffer = this.ensureCapacity(
      this.retreatEndBuffer,
      required,
    );
  }

  private ensureAdvanceRangeCapacity(required: number): void {
    if (required <= this.advanceStartBuffer.length) {
      return;
    }
    this.advanceStartBuffer = this.ensureCapacity(
      this.advanceStartBuffer,
      required,
    );
    this.advanceEndBuffer = this.ensureCapacity(
      this.advanceEndBuffer,
      required,
    );
  }

  private paintVersion(
    version: ReadonlySet<EventId>,
    color: number,
    view: PackedDiffVersionsView,
  ): number {
    let pendingDivergent = 0;
    for (const id of version) {
      const offset = view.offsetOf(id);
      if (offset !== undefined) {
        pendingDivergent += this.paint(offset, color);
      }
    }
    return pendingDivergent;
  }

  private paintParents(
    eventOffset: number,
    color: number,
    view: PackedDiffVersionsView,
  ): number {
    let pendingDivergent = 0;
    const parentCount = view.parentCountAt(eventOffset);
    for (let parentIndex = 0; parentIndex < parentCount; parentIndex++) {
      const parentOffset = view.parentOffsetAt(eventOffset, parentIndex);
      if (parentOffset === undefined) {
        throw new Error(
          `Packed event ${eventOffset} is missing parent ${parentIndex}`,
        );
      }
      pendingDivergent += this.paint(parentOffset, color);
    }
    return pendingDivergent;
  }

  private collectTransition(
    initialPendingDivergent: number,
    view: PackedDiffVersionsView,
  ): void {
    this.collectRangeTransition(initialPendingDivergent, view);
    // Expand ranges into scalar offsets: retreat descending, advance ascending.
    for (let range = 0; range < this.retreatRangeLength; range++) {
      const start = this.retreatStartBuffer[range]!;
      for (
        let offset = this.retreatEndBuffer[range]! - 1;
        offset >= start;
        offset--
      ) {
        this.emitScalar(offset, DIFF_COLOR.LEFT);
      }
    }
    for (let range = 0; range < this.advanceRangeLength; range++) {
      const end = this.advanceEndBuffer[range]!;
      for (
        let offset = this.advanceStartBuffer[range]!;
        offset < end;
        offset++
      ) {
        this.emitScalar(offset, DIFF_COLOR.RIGHT);
      }
    }
  }

  /**
   * Collect the transition directly into local-version ranges.
   *
   * The walk yields both sides in descending local version. Retreat ranges
   * therefore arrive in their final order. Advance ranges are accumulated in
   * the inverse direction, then their range pairs (not their events) are
   * reversed so callers can expand them in ascending local version.
   */
  private collectRangeTransition(
    initialPendingDivergent: number,
    view: PackedDiffVersionsView,
  ): void {
    this.walkDivergent(initialPendingDivergent, view.runs);

    for (
      let left = 0, right = this.advanceRangeLength - 1;
      left < right;
      left++, right--
    ) {
      const start = this.advanceStartBuffer[left]!;
      const end = this.advanceEndBuffer[left]!;
      this.advanceStartBuffer[left] = this.advanceStartBuffer[right]!;
      this.advanceEndBuffer[left] = this.advanceEndBuffer[right]!;
      this.advanceStartBuffer[right] = start;
      this.advanceEndBuffer[right] = end;
    }
  }

  /**
   * Visit painted events in descending local version, one run at a time,
   * until no one-sided event remains queued.
   *
   * Every event of a run after its first has the previous event as its only
   * parent, so a colour flows unchanged down a run until it reaches another
   * queued event of the same run, where the two colours merge. The walk
   * therefore pops the highest queued event, absorbs every other queued
   * event of its run, emits the run's coloured spans, and queues the parents
   * of the run's first event. Its cost follows the runs it visits, not the
   * events in them.
   */
  private walkDivergent(
    initialPendingDivergent: number,
    runs: GraphRuns,
  ): void {
    const colors = this.colors;
    let pendingDivergent = initialPendingDivergent;
    while (this.heapLength > 0 && pendingDivergent > 0) {
      let top = this.pop();
      let color = colors[top]!;
      if (color !== DIFF_COLOR.COMMON) {
        pendingDivergent--;
      }
      const run = runs.runOf(top);
      const start = runs.startOf(run);
      while (this.heapLength > 0 && this.heap[0]! >= start) {
        const next = this.pop();
        this.emitSpan(next + 1, top + 1, color);
        const nextColor = colors[next]!;
        if (nextColor !== DIFF_COLOR.COMMON) {
          pendingDivergent--;
        }
        color |= nextColor;
        top = next;
      }
      this.emitSpan(start, top + 1, color);
      if (pendingDivergent === 0 && color === DIFF_COLOR.COMMON) {
        break;
      }
      const parentCount = runs.parentCountOf(run);
      for (let parentIndex = 0; parentIndex < parentCount; parentIndex++) {
        pendingDivergent += this.paint(
          runs.lastOf(runs.parentRunAt(run, parentIndex)),
          color,
        );
      }
    }
  }

  /** Record events `[start, end)`, visited in descending order, by colour. */
  private emitSpan(start: number, end: number, color: number): void {
    if (start >= end || color === DIFF_COLOR.COMMON) {
      return;
    }
    if (color === DIFF_COLOR.LEFT) {
      this.retreatRangeEventLength += end - start;
      const previous = this.retreatRangeLength - 1;
      if (previous >= 0 && end === this.retreatStartBuffer[previous]) {
        this.retreatStartBuffer[previous] = start;
        return;
      }
      this.ensureRetreatRangeCapacity(this.retreatRangeLength + 1);
      this.retreatStartBuffer[this.retreatRangeLength] = start;
      this.retreatEndBuffer[this.retreatRangeLength] = end;
      this.retreatRangeLength++;
      return;
    }
    this.advanceRangeEventLength += end - start;
    const previous = this.advanceRangeLength - 1;
    if (previous >= 0 && end === this.advanceStartBuffer[previous]) {
      this.advanceStartBuffer[previous] = start;
      return;
    }
    this.ensureAdvanceRangeCapacity(this.advanceRangeLength + 1);
    this.advanceStartBuffer[this.advanceRangeLength] = start;
    this.advanceEndBuffer[this.advanceRangeLength] = end;
    this.advanceRangeLength++;
  }

  private emitScalar(offset: number, color: number): void {
    if (color === DIFF_COLOR.LEFT) {
      this.retreatBuffer = this.ensureCapacity(
        this.retreatBuffer,
        this.retreatLength + 1,
      );
      this.retreatBuffer[this.retreatLength++] = offset;
    } else {
      this.advanceBuffer = this.ensureCapacity(
        this.advanceBuffer,
        this.advanceLength + 1,
      );
      this.advanceBuffer[this.advanceLength++] = offset;
    }
    this.scalarOffsetWrites++;
  }

  /**
   * Merge one colour and return its contribution to pendingDivergent.
   * A positive result represents a newly queued one-sided event; -1 means a
   * queued event has just become common.
   */
  private paint(offset: number, addedColor: number): number {
    const existing = this.colors[offset]!;
    const merged = existing | addedColor;
    if (merged === existing) {
      return 0;
    }

    this.colors[offset] = merged;
    if (existing === 0) {
      this.recordTouched(offset);
      this.push(offset);
      return merged === DIFF_COLOR.COMMON ? 0 : 1;
    }
    return merged === DIFF_COLOR.COMMON ? -1 : 0;
  }

  private push(offset: number): void {
    this.heap = this.ensureCapacity(this.heap, this.heapLength + 1);
    let index = this.heapLength++;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      const parentOffset = this.heap[parent]!;
      if (parentOffset >= offset) {
        break;
      }
      this.heap[index] = parentOffset;
      index = parent;
    }
    this.heap[index] = offset;
  }

  private pop(): number {
    const top = this.heap[0]!;
    const last = this.heap[--this.heapLength]!;
    if (this.heapLength === 0) {
      return top;
    }

    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      if (left >= this.heapLength) {
        break;
      }
      const right = left + 1;
      const largerChild =
        right < this.heapLength && this.heap[right]! > this.heap[left]!
          ? right
          : left;
      if (this.heap[largerChild]! <= last) {
        break;
      }
      this.heap[index] = this.heap[largerChild]!;
      index = largerChild;
    }
    this.heap[index] = last;
    return top;
  }

  private recordTouched(offset: number): void {
    this.touched = this.ensureCapacity(this.touched, this.touchedLength + 1);
    this.touched[this.touchedLength++] = offset;
  }

  private ensureCapacity(current: Uint32Array, required: number): Uint32Array {
    if (required <= current.length) {
      return current;
    }
    if (required > this.eventCount) {
      throw new Error("Packed diff workspace exceeded the event count");
    }

    let capacity = Math.max(1, current.length);
    while (capacity < required) {
      capacity = Math.min(this.eventCount, capacity * 2);
    }
    const grown = new Uint32Array(capacity);
    grown.set(current);
    return grown;
  }

  private requireId(view: PackedDiffVersionsView, offset: number): EventId {
    const id = view.idAt(offset);
    if (id === undefined) {
      throw new Error(`Packed graph is missing event ${offset}`);
    }
    return id;
  }

  private assertEventOffset(offset: number): void {
    if (!Number.isInteger(offset) || offset < 0 || offset >= this.eventCount) {
      throw new RangeError(`Invalid packed event offset ${offset}`);
    }
  }

  private finish(): void {
    for (let index = 0; index < this.touchedLength; index++) {
      this.colors[this.touched[index]!] = 0;
    }
    this.heapLength = 0;
    this.touchedLength = 0;
    this.active = false;
  }
}
