import type {
  EventGraph,
  PackedReplayPlanningView,
} from "../graph/event-graph";
import type { EventId, GraphEvent } from "../types";
import type { ExternalOperation } from "../types";
import type {
  PackedLocalVersionTransition,
  PackedOffsetTransition,
} from "../graph/internals/packed-diff-versions";

/**
 * Critical-section cuts over a packed graph without per-section objects.
 *
 * Section bounds index into one branch-preserving numeric event order. A
 * section's base frontier is always the previous cut's end frontier, so the
 * executor can carry that frontier forward instead of storing a copy at every
 * cut. In practice most paper traces have hundreds of thousands of singleton
 * cuts; this representation needs five bytes per possible cut rather than an
 * object, an event slice, and two Sets.
 */
export class PackedCriticalReplayPlan {
  private readonly numericFrontier: Uint8Array;
  private readonly numericBaseOffsets: number[] = [];

  constructor(
    private readonly graph: PackedReplayPlanningView,
    private readonly eventOrder: Uint32Array,
    private readonly rankByOffset: Uint32Array,
    private readonly sectionEnds: Uint32Array,
    private readonly linearSections: Uint8Array,
    readonly sectionCount: number,
    /** Runs the planner visited; it scanned edges once per run. */
    readonly runCount: number,
  ) {
    this.numericFrontier = new Uint8Array(eventOrder.length);
  }

  get eventCount(): number {
    return this.eventOrder.length;
  }

  sectionStartAt(sectionIndex: number): number {
    this.assertSectionIndex(sectionIndex);
    return sectionIndex === 0 ? 0 : this.sectionEnds[sectionIndex - 1]!;
  }

  sectionEndAt(sectionIndex: number): number {
    this.assertSectionIndex(sectionIndex);
    return this.sectionEnds[sectionIndex]!;
  }

  /**
   * Last section whose end frontier covers at most `eventCount` events, or
   * -1 when even the first section is larger.
   */
  lastSectionEndingAtOrBefore(eventCount: number): number {
    let low = 0;
    let high = this.sectionCount - 1;
    let found = -1;
    while (low <= high) {
      const middle = (low + high) >>> 1;
      if (this.sectionEnds[middle]! <= eventCount) {
        found = middle;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    return found;
  }

  sectionEventCountAt(sectionIndex: number): number {
    return this.sectionEndAt(sectionIndex) - this.sectionStartAt(sectionIndex);
  }

  isLinearSection(sectionIndex: number): boolean {
    this.assertSectionIndex(sectionIndex);
    return this.linearSections[sectionIndex] === 1;
  }

  eventIdAt(orderIndex: number): EventId {
    return this.eventIdAtKnownOffset(this.eventOffsetAt(orderIndex));
  }

  eventIdAtOffset(offset: number): EventId {
    this.assertEventOffset(offset);
    return this.eventIdAtKnownOffset(offset);
  }

  /**
   * @internal Agent of the event at `offset`, or `-1` when its ID is not a
   * canonical `replicaId:sequence`. Offsets are the graph's local versions.
   */
  agentAtKnownOffset(offset: number): number {
    return this.graph.agentAt(offset);
  }

  /** @internal Sequence of the event at `offset`. */
  sequenceAtKnownOffset(offset: number): number {
    return this.graph.sequenceAt(offset);
  }

  /** @internal `offset` must originate from this plan or one of its diffs. */
  eventIdAtKnownOffset(offset: number): EventId {
    const id = this.graph.idAt(offset);
    if (id === undefined) {
      throw new Error(
        `Packed replay plan is missing event at offset ${offset}`,
      );
    }
    return id;
  }

  eventAt(orderIndex: number): GraphEvent {
    const offset = this.eventOffsetAt(orderIndex);
    const event = this.graph.eventAt(offset);
    if (event === undefined) {
      throw new Error(
        `Packed replay plan is missing event at offset ${offset}`,
      );
    }
    return event;
  }

  operationAt(orderIndex: number): ExternalOperation {
    return this.graph.operationAt(this.eventOffsetAt(orderIndex));
  }

  materializeSection(sectionIndex: number): ReadonlyArray<GraphEvent> {
    return this.materializeSectionRange(sectionIndex, sectionIndex + 1);
  }

  /** Materialise one contiguous range without intermediate section arrays. */
  materializeSectionRange(
    startSectionIndex: number,
    endSectionIndex: number,
  ): ReadonlyArray<GraphEvent> {
    const { start, end } = this.sectionRangeBounds(
      startSectionIndex,
      endSectionIndex,
    );
    const events = new Array<GraphEvent>(end - start);
    for (let orderIndex = start; orderIndex < end; orderIndex++) {
      events[orderIndex - start] = this.eventAt(orderIndex);
    }
    return Object.freeze(events);
  }

  advanceFrontierRange(
    base: ReadonlySet<EventId>,
    startSectionIndex: number,
    endSectionIndex: number,
  ): Set<EventId> {
    const { start, end } = this.sectionRangeBounds(
      startSectionIndex,
      endSectionIndex,
    );
    const marks = this.numericFrontier;
    const baseOffsets = this.numericBaseOffsets;
    const frontier = new Set<EventId>();
    baseOffsets.length = 0;

    for (const eventId of base) {
      const offset = this.graph.offsetOf(eventId);
      if (offset === undefined) {
        // Preserve the historical Set implementation's behavior for an
        // out-of-graph base ID. Valid replay frontiers never take this path,
        // but retaining it keeps the internal helper total for callers.
        frontier.add(eventId);
        continue;
      }
      marks[offset] = 1;
      baseOffsets.push(offset);
    }

    try {
      for (let orderIndex = start; orderIndex < end; orderIndex++) {
        const eventOffset = this.eventOffsetAt(orderIndex);
        const parentCount = this.graph.parentCountAt(eventOffset);
        for (let parentIndex = 0; parentIndex < parentCount; parentIndex++) {
          const parentOffset = this.graph.parentOffsetAt(
            eventOffset,
            parentIndex,
          );
          if (parentOffset === undefined) {
            throw new Error(
              `Packed replay event ${eventOffset} is missing parent ${parentIndex}`,
            );
          }
          marks[parentOffset] = 0;
        }
        marks[eventOffset] = 1;
      }

      // Only the base frontier and events in this range can be live. Walk
      // those compact numeric sources and materialize string IDs once for the
      // usually tiny end frontier, instead of hashing strings for every event.
      for (let index = 0; index < baseOffsets.length; index++) {
        const offset = baseOffsets[index]!;
        if (marks[offset] === 1) {
          frontier.add(this.eventIdAtKnownOffset(offset));
        }
      }
      for (let orderIndex = start; orderIndex < end; orderIndex++) {
        const eventOffset = this.eventOffsetAt(orderIndex);
        if (marks[eventOffset] === 1) {
          frontier.add(this.eventIdAtKnownOffset(eventOffset));
        }
      }
      return frontier;
    } finally {
      for (let index = 0; index < baseOffsets.length; index++) {
        marks[baseOffsets[index]!] = 0;
      }
      for (let orderIndex = start; orderIndex < end; orderIndex++) {
        marks[this.eventOffsetAt(orderIndex)] = 0;
      }
      baseOffsets.length = 0;
    }
  }

  eventIdsInSectionRange(
    startSectionIndex: number,
    endSectionIndex: number,
  ): ReadonlyArray<EventId> {
    const { start, end } = this.sectionRangeBounds(
      startSectionIndex,
      endSectionIndex,
    );
    const ids = new Array<EventId>(end - start);
    for (let orderIndex = start; orderIndex < end; orderIndex++) {
      ids[orderIndex - start] = this.eventIdAt(orderIndex);
    }
    return Object.freeze(ids);
  }

  /** @internal Whether an event's parents are exactly `version`'s offsets. */
  parentsEqualLocalVersionsAtKnownOffset(
    eventOffset: number,
    version: ReadonlyArray<number>,
  ): boolean {
    const parentCount = this.graph.parentCountAt(eventOffset);
    if (parentCount !== version.length) {
      return false;
    }
    for (let parentIndex = 0; parentIndex < parentCount; parentIndex++) {
      const parentOffset = this.graph.parentOffsetAt(eventOffset, parentIndex);
      if (parentOffset === undefined || !version.includes(parentOffset)) {
        return false;
      }
    }
    return true;
  }

  /** @internal `targetEventOffset` must originate from this plan. */
  transitionRangesFromLocalVersionsToKnownOffset(
    currentVersion: ReadonlyArray<number>,
    targetEventOffset: number,
  ): PackedLocalVersionTransition {
    return this.graph.diffLocalVersionsToParentRanges(
      currentVersion,
      targetEventOffset,
    );
  }

  /** @internal Both offsets must originate from this plan. */
  hasSingleParentAtKnownOffset(
    eventOffset: number,
    parentOffset: number,
  ): boolean {
    return this.graph.runs.hasSingleParent(eventOffset, parentOffset);
  }

  orderIndexOfOffset(offset: number): number {
    this.assertEventOffset(offset);
    return this.orderIndexOfKnownOffset(offset);
  }

  /** @internal `offset` must originate from this plan or one of its diffs. */
  orderIndexOfKnownOffset(offset: number): number {
    return this.rankByOffset[offset]!;
  }

  /** @internal `offset` must originate from this plan or one of its diffs. */
  isInsertAtKnownOffset(offset: number): boolean {
    return this.graph.isInsertAt(offset);
  }

  /** @internal `targetEventOffset` must originate from this plan. */
  transitionFromVersionToKnownOffset(
    currentVersion: ReadonlySet<EventId>,
    targetEventOffset: number,
  ): PackedOffsetTransition {
    return this.graph.diffVersionToParents(currentVersion, targetEventOffset);
  }

  /** @internal `targetEventOffset` must originate from this plan. */
  transitionRangesFromVersionToKnownOffset(
    currentVersion: ReadonlySet<EventId>,
    targetEventOffset: number,
  ): PackedLocalVersionTransition {
    return this.graph.diffVersionToParentRanges(
      currentVersion,
      targetEventOffset,
    );
  }

  /** @internal Both offsets must originate from this plan. */
  transitionBetweenKnownOffsets(
    currentOffset: number,
    targetEventOffset: number,
  ): PackedOffsetTransition {
    return this.graph.diffOffsetToParents(currentOffset, targetEventOffset);
  }

  /** @internal Both offsets must originate from this plan. */
  transitionRangesBetweenKnownOffsets(
    currentOffset: number,
    targetEventOffset: number,
  ): PackedLocalVersionTransition {
    return this.graph.diffOffsetToParentRanges(
      currentOffset,
      targetEventOffset,
    );
  }

  isInsertAt(orderIndex: number): boolean {
    return this.isInsertAtKnownOffset(this.eventOffsetAt(orderIndex));
  }

  operationIndexAt(orderIndex: number): number {
    return this.operationIndexAtKnownOffset(this.eventOffsetAt(orderIndex));
  }

  operationLengthAt(orderIndex: number): number {
    return this.operationLengthAtKnownOffset(this.eventOffsetAt(orderIndex));
  }

  insertStartAt(orderIndex: number): number {
    return this.insertStartAtKnownOffset(this.eventOffsetAt(orderIndex));
  }

  /** @internal `offset` must originate from this plan. */
  operationIndexAtKnownOffset(offset: number): number {
    return this.graph.operationIndexAt(offset);
  }

  /** @internal `offset` must originate from this plan. */
  operationLengthAtKnownOffset(offset: number): number {
    return this.graph.operationLengthAt(offset);
  }

  /** @internal `offset` must originate from this plan. */
  insertStartAtKnownOffset(offset: number): number {
    return this.graph.insertStartAt(offset);
  }

  sliceInsertedContent(start: number, end: number): string {
    return this.graph.sliceInsertedContent(start, end);
  }

  eventOffsetAt(orderIndex: number): number {
    if (
      !Number.isInteger(orderIndex) ||
      orderIndex < 0 ||
      orderIndex >= this.eventOrder.length
    ) {
      throw new RangeError(`Invalid packed replay order index ${orderIndex}`);
    }
    return this.eventOrder[orderIndex]!;
  }

  private sectionRangeBounds(
    startSectionIndex: number,
    endSectionIndex: number,
  ): { readonly start: number; readonly end: number } {
    this.assertSectionIndex(startSectionIndex);
    if (
      !Number.isInteger(endSectionIndex) ||
      endSectionIndex <= startSectionIndex ||
      endSectionIndex > this.sectionCount
    ) {
      throw new RangeError(
        `Invalid packed replay section range ${startSectionIndex}..${endSectionIndex}`,
      );
    }
    return {
      start: this.sectionStartAt(startSectionIndex),
      end: this.sectionEndAt(endSectionIndex - 1),
    };
  }

  private assertEventOffset(offset: number): void {
    if (!Number.isInteger(offset) || offset < 0 || offset >= this.eventCount) {
      throw new RangeError(`Invalid packed replay event offset ${offset}`);
    }
  }

  private assertSectionIndex(sectionIndex: number): void {
    if (
      !Number.isInteger(sectionIndex) ||
      sectionIndex < 0 ||
      sectionIndex >= this.sectionCount
    ) {
      throw new RangeError(`Invalid packed replay section ${sectionIndex}`);
    }
  }
}

/**
 * Plan critical replay directly over the packed graph's runs.
 *
 * Returns `null` for object-backed or mixed packed/mutable graphs so those
 * graphs retain the general public planner. The packed codec has already
 * validated IDs, parents, cycles, and topological insertion ranks.
 */
export const planPackedCriticalReplaySections = (
  source: EventGraph,
): PackedCriticalReplayPlan | null => {
  const graph = source.getPackedReplayPlanningView();
  if (graph === null) {
    return null;
  }
  const layout = graph.buildBranchPreservingCriticalReplayLayout();

  return new PackedCriticalReplayPlan(
    graph,
    layout.eventOrder,
    layout.rankByOffset,
    layout.sectionEnds,
    layout.linearSections,
    layout.sectionCount,
    layout.runCount,
  );
};
