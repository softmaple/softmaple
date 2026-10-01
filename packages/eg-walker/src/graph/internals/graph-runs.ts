/**
 * An event graph as runs of consecutive local versions.
 *
 * Run `r` holds the local versions `[startOf(r), endOf(r))`. Every event after
 * a run's first has the previous local version as its only parent, and that
 * parent has no other child. Runs therefore split where an event has several
 * parents or a parent other than the previous event, and where an event has
 * more than one child. Every edge between two runs goes from the last event of
 * one run to the first event of another, so graph traversals can visit runs
 * instead of events.
 *
 * Real editing histories have few runs: a sequential trace is one run, and an
 * asynchronous one has a few thousand over hundreds of thousands of events.
 */
export class GraphRuns {
  /** Number of runs. */
  readonly count: number;
  /** Number of events the runs cover. */
  readonly eventCount: number;
  /** `starts[r]` is run `r`'s first local version; `starts[count]` is the event count. */
  private readonly starts: Uint32Array;
  /** Parents of each run's first event, as run indexes, in event parent order. */
  private readonly parentStarts: Uint32Array;
  private readonly parentRuns: Uint32Array;
  /** Children of each run's last event, as run indexes, in ascending order. */
  private readonly childStarts: Uint32Array;
  private readonly childRuns: Uint32Array;
  /** Run of the previous lookup: scans read neighbouring local versions. */
  private hint = 0;

  private constructor(
    eventCount: number,
    starts: Uint32Array,
    parentStarts: Uint32Array,
    parentRuns: Uint32Array,
    childStarts: Uint32Array,
    childRuns: Uint32Array,
  ) {
    this.eventCount = eventCount;
    this.count = starts.length - 1;
    this.starts = starts;
    this.parentStarts = parentStarts;
    this.parentRuns = parentRuns;
    this.childStarts = childStarts;
    this.childRuns = childRuns;
  }

  /** One causal chain of `eventCount` events, or no run for no event. */
  static linear(eventCount: number): GraphRuns {
    if (eventCount === 0) {
      const empty = new Uint32Array(1);
      return new GraphRuns(
        0,
        empty,
        empty,
        new Uint32Array(0),
        empty,
        new Uint32Array(0),
      );
    }
    return new GraphRuns(
      eventCount,
      Uint32Array.of(0, eventCount),
      new Uint32Array(2),
      new Uint32Array(0),
      new Uint32Array(2),
      new Uint32Array(0),
    );
  }

  /**
   * Build runs from the events whose parents are not just their predecessor.
   *
   * Every other event `lv > 0` has `lv - 1` as its only parent, and event 0
   * has none unless it is listed. `explicit` lists local versions in
   * ascending order; the parents of `explicit[i]` are
   * `parents[parentStarts[i]..parentStarts[i + 1])`, in the event's parent
   * order, each below the event. Work and memory follow the listed events
   * and their parents, not the event count.
   */
  static fromExplicitParents(
    eventCount: number,
    explicit: ArrayLike<number>,
    parentStarts: ArrayLike<number>,
    parents: ArrayLike<number>,
  ): GraphRuns {
    if (eventCount === 0) {
      return GraphRuns.linear(0);
    }
    // A run starts at event 0, at every event whose parents are not just its
    // predecessor, and after every event with a child other than its
    // successor.
    let candidateCount = 1;
    for (let index = 0; index < explicit.length; index++) {
      candidateCount += 1 + parentStarts[index + 1]! - parentStarts[index]!;
    }
    const candidates = new Uint32Array(candidateCount);
    let candidate = 1;
    for (let index = 0; index < explicit.length; index++) {
      const lv = explicit[index]!;
      const start = parentStarts[index]!;
      const end = parentStarts[index + 1]!;
      if (lv > 0 && (end - start !== 1 || parents[start] !== lv - 1)) {
        candidates[candidate++] = lv;
      }
      for (let edge = start; edge < end; edge++) {
        const parent = parents[edge]!;
        if (parent !== lv - 1 && parent + 1 < eventCount) {
          candidates[candidate++] = parent + 1;
        }
      }
    }
    const sorted = candidates.subarray(0, candidate).sort();
    let runCount = 0;
    for (let index = 0; index < sorted.length; index++) {
      if (index === 0 || sorted[index] !== sorted[index - 1]) {
        sorted[runCount++] = sorted[index]!;
      }
    }
    const starts = new Uint32Array(runCount + 1);
    starts.set(sorted.subarray(0, runCount));
    starts[runCount] = eventCount;

    // Parents of each run's first event: listed, or its predecessor.
    const runParentStarts = new Uint32Array(runCount + 1);
    const runParents: number[] = [];
    let cursor = 0;
    for (let run = 0; run < runCount; run++) {
      const lv = starts[run]!;
      while (cursor < explicit.length && explicit[cursor]! < lv) {
        cursor++;
      }
      if (cursor < explicit.length && explicit[cursor] === lv) {
        const end = parentStarts[cursor + 1]!;
        for (let edge = parentStarts[cursor]!; edge < end; edge++) {
          runParents.push(runContaining(starts, runCount, parents[edge]!));
        }
      } else if (lv > 0) {
        runParents.push(run - 1);
      }
      runParentStarts[run + 1] = runParents.length;
    }
    const parentRuns = Uint32Array.from(runParents);
    const childStarts = new Uint32Array(runCount + 1);
    for (let edge = 0; edge < parentRuns.length; edge++) {
      childStarts[parentRuns[edge]! + 1]!++;
    }
    return new GraphRuns(
      eventCount,
      starts,
      runParentStarts,
      parentRuns,
      ...reverseEdges(runCount, runParentStarts, parentRuns, childStarts),
    );
  }

  /** Whether the runs are one causal chain from a single root. */
  isLinear(): boolean {
    return this.count <= 1 && this.parentStarts[this.count] === 0;
  }

  /** Number of parent edges between runs. */
  get edgeCount(): number {
    return this.parentRuns.length;
  }

  startOf(run: number): number {
    return this.starts[run]!;
  }

  endOf(run: number): number {
    return this.starts[run + 1]!;
  }

  /** Last local version of a run. */
  lastOf(run: number): number {
    return this.starts[run + 1]! - 1;
  }

  /** Run holding local version `lv`, which must be below the event count. */
  runOf(lv: number): number {
    const starts = this.starts;
    const hint = this.hint;
    if (starts[hint]! <= lv && lv < starts[hint + 1]!) {
      return hint;
    }
    // Forward scans read the next run and version diffs the previous one.
    if (lv >= starts[hint + 1]!) {
      if (hint + 1 < this.count && lv < starts[hint + 2]!) {
        return (this.hint = hint + 1);
      }
    } else if (hint > 0 && lv >= starts[hint - 1]!) {
      return (this.hint = hint - 1);
    }
    return (this.hint = runContaining(starts, this.count, lv));
  }

  parentCountOf(run: number): number {
    return this.parentStarts[run + 1]! - this.parentStarts[run]!;
  }

  parentRunAt(run: number, parentIndex: number): number {
    return this.parentRuns[this.parentStarts[run]! + parentIndex]!;
  }

  childCountOf(run: number): number {
    return this.childStarts[run + 1]! - this.childStarts[run]!;
  }

  childRunAt(run: number, childIndex: number): number {
    return this.childRuns[this.childStarts[run]! + childIndex]!;
  }

  /** Number of parents of the event at `lv`. */
  parentCountAt(lv: number): number {
    const run = this.runOf(lv);
    return lv === this.starts[run] ? this.parentCountOf(run) : 1;
  }

  /** A parent of the event at `lv`, or `-1` when it has no such parent. */
  parentAt(lv: number, parentIndex: number): number {
    const run = this.runOf(lv);
    if (lv !== this.starts[run]) {
      return parentIndex === 0 ? lv - 1 : -1;
    }
    return parentIndex < this.parentCountOf(run)
      ? this.lastOf(this.parentRunAt(run, parentIndex))
      : -1;
  }

  /** Number of children of the event at `lv`. */
  childCountAt(lv: number): number {
    const run = this.runOf(lv);
    return lv === this.lastOf(run) ? this.childCountOf(run) : 1;
  }

  /** A child of the event at `lv`, or `-1` when it has no such child. */
  childAt(lv: number, childIndex: number): number {
    const run = this.runOf(lv);
    if (lv !== this.lastOf(run)) {
      return childIndex === 0 ? lv + 1 : -1;
    }
    return childIndex < this.childCountOf(run)
      ? this.starts[this.childRunAt(run, childIndex)]!
      : -1;
  }

  /** Whether the event at `lv` has exactly the parent `parent`. */
  hasSingleParent(lv: number, parent: number): boolean {
    const run = this.runOf(lv);
    if (lv !== this.starts[run]) {
      return parent === lv - 1;
    }
    return (
      this.parentCountOf(run) === 1 &&
      this.lastOf(this.parentRunAt(run, 0)) === parent
    );
  }
}

/** Index of the run whose range holds `lv`, by binary search. */
const runContaining = (
  starts: Uint32Array,
  runCount: number,
  lv: number,
): number => {
  let low = 0;
  let high = runCount - 1;
  while (low < high) {
    const middle = (low + high + 1) >>> 1;
    if (starts[middle]! <= lv) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return low;
};

/** Child CSR of a run graph, children in ascending run order. */
const reverseEdges = (
  runCount: number,
  parentStarts: Uint32Array,
  parentRuns: Uint32Array,
  childStarts: Uint32Array,
): [Uint32Array, Uint32Array] => {
  for (let run = 0; run < runCount; run++) {
    childStarts[run + 1] = childStarts[run + 1]! + childStarts[run]!;
  }
  const childRuns = new Uint32Array(parentRuns.length);
  const cursors = childStarts.slice(0, runCount);
  for (let run = 0; run < runCount; run++) {
    const end = parentStarts[run + 1]!;
    for (let edge = parentStarts[run]!; edge < end; edge++) {
      const parent = parentRuns[edge]!;
      childRuns[cursors[parent]!++] = run;
    }
  }
  return [childStarts, childRuns];
};
