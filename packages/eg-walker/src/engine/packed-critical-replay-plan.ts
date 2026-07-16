import type {
  EventGraph,
  PackedReplayPlanningView,
} from "../graph/event-graph";
import type { PackedCanonicalIdRun } from "../graph/internals/packed-event-graph-base";
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

  /** @internal Canonical ID interval retained by the packed EGW3 index. */
  canonicalIdRunAtKnownOffset(
    offset: number,
  ): PackedCanonicalIdRun | undefined {
    return this.graph.canonicalIdRunAt?.(offset);
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

  parentsEqualVersionAt(
    orderIndex: number,
    version: ReadonlySet<EventId>,
  ): boolean {
    return this.parentsEqualVersionAtKnownOffset(
      this.eventOffsetAt(orderIndex),
      version,
    );
  }

  /** @internal `eventOffset` must originate from this plan. */
  parentsEqualVersionAtKnownOffset(
    eventOffset: number,
    version: ReadonlySet<EventId>,
  ): boolean {
    const parentCount = this.graph.parentCountAt(eventOffset);
    if (parentCount !== version.size) {
      return false;
    }
    for (let parentIndex = 0; parentIndex < parentCount; parentIndex++) {
      const parentOffset = this.graph.parentOffsetAt(eventOffset, parentIndex);
      if (
        parentOffset === undefined ||
        !version.has(this.eventIdAtOffset(parentOffset))
      ) {
        return false;
      }
    }
    return true;
  }

  hasSingleParentOffsetAt(orderIndex: number, parentOffset: number): boolean {
    return this.hasSingleParentAtKnownOffset(
      this.eventOffsetAt(orderIndex),
      parentOffset,
    );
  }

  /** @internal Both offsets must originate from this plan. */
  hasSingleParentAtKnownOffset(
    eventOffset: number,
    parentOffset: number,
  ): boolean {
    return (
      this.graph.parentCountAt(eventOffset) === 1 &&
      this.graph.parentOffsetAt(eventOffset, 0) === parentOffset
    );
  }

  orderIndexOfOffset(offset: number): number {
    this.assertEventOffset(offset);
    return this.orderIndexOfKnownOffset(offset);
  }

  /** @internal `offset` must originate from this plan or one of its diffs. */
  orderIndexOfKnownOffset(offset: number): number {
    return this.rankByOffset[offset]!;
  }

  isInsertAtOffset(offset: number): boolean {
    this.assertEventOffset(offset);
    return this.isInsertAtKnownOffset(offset);
  }

  /** @internal `offset` must originate from this plan or one of its diffs. */
  isInsertAtKnownOffset(offset: number): boolean {
    return this.graph.isInsertAt(offset);
  }

  transitionFromVersion(
    currentVersion: ReadonlySet<EventId>,
    targetOrderIndex: number,
  ): PackedOffsetTransition {
    return this.transitionFromVersionToKnownOffset(
      currentVersion,
      this.eventOffsetAt(targetOrderIndex),
    );
  }

  /** @internal `targetEventOffset` must originate from this plan. */
  transitionFromVersionToKnownOffset(
    currentVersion: ReadonlySet<EventId>,
    targetEventOffset: number,
  ): PackedOffsetTransition {
    return this.graph.diffVersionToParents(
      currentVersion,
      targetEventOffset,
      this.rankByOffset,
    );
  }

  transitionRangesFromVersion(
    currentVersion: ReadonlySet<EventId>,
    targetOrderIndex: number,
  ): PackedLocalVersionTransition {
    return this.transitionRangesFromVersionToKnownOffset(
      currentVersion,
      this.eventOffsetAt(targetOrderIndex),
    );
  }

  /** @internal `targetEventOffset` must originate from this plan. */
  transitionRangesFromVersionToKnownOffset(
    currentVersion: ReadonlySet<EventId>,
    targetEventOffset: number,
  ): PackedLocalVersionTransition {
    return this.graph.diffVersionToParentRanges(
      currentVersion,
      targetEventOffset,
      this.rankByOffset,
    );
  }

  transitionFromOffset(
    currentOffset: number,
    targetOrderIndex: number,
  ): PackedOffsetTransition {
    this.assertEventOffset(currentOffset);
    return this.transitionBetweenKnownOffsets(
      currentOffset,
      this.eventOffsetAt(targetOrderIndex),
    );
  }

  /** @internal Both offsets must originate from this plan. */
  transitionBetweenKnownOffsets(
    currentOffset: number,
    targetEventOffset: number,
  ): PackedOffsetTransition {
    return this.graph.diffOffsetToParents(
      currentOffset,
      targetEventOffset,
      this.rankByOffset,
    );
  }

  transitionRangesFromOffset(
    currentOffset: number,
    targetOrderIndex: number,
  ): PackedLocalVersionTransition {
    this.assertEventOffset(currentOffset);
    return this.transitionRangesBetweenKnownOffsets(
      currentOffset,
      this.eventOffsetAt(targetOrderIndex),
    );
  }

  /** @internal Both offsets must originate from this plan. */
  transitionRangesBetweenKnownOffsets(
    currentOffset: number,
    targetEventOffset: number,
  ): PackedLocalVersionTransition {
    return this.graph.diffOffsetToParentRanges(
      currentOffset,
      targetEventOffset,
      this.rankByOffset,
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
 * Plan critical replay directly over packed CSR columns.
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

  const eventOrder = graph.getBranchPreservingOrderOffsets();
  const eventCount = eventOrder.length;

  if (eventCount === 0) {
    return new PackedCriticalReplayPlan(
      graph,
      eventOrder,
      eventOrder,
      new Uint32Array(),
      new Uint8Array(),
      0,
    );
  }

  // Exact chains bypass this planner in EgWalkerReplica, but collapsing them
  // here keeps this function equivalent to the general planner for direct
  // callers and tests.
  if (source.isExactLinearHistory()) {
    return new PackedCriticalReplayPlan(
      graph,
      eventOrder,
      eventOrder,
      new Uint32Array([eventCount]),
      new Uint8Array([1]),
      1,
    );
  }

  const sectionEnds = new Uint32Array(eventCount);
  const linearSections = new Uint8Array(eventCount);
  const remainingParents = new Uint32Array(eventCount);
  const ready = new Uint8Array(eventCount);
  const prefixFrontier = new Uint8Array(eventCount);
  const readyParentCoverage = new Uint32Array(eventCount);
  let readyCount = 0;

  for (let offset = 0; offset < eventCount; offset++) {
    const parentCount = graph.parentCountAt(offset);
    remainingParents[offset] = parentCount;
    if (parentCount === 0) {
      ready[offset] = 1;
      readyCount++;
    }
  }

  let prefixFrontierSize = 0;
  let missingReadyParentPairs = 0;
  let sectionCount = 0;
  let sectionStart = 0;
  let sectionIsLinear = true;

  for (let orderIndex = 0; orderIndex < eventCount; orderIndex++) {
    const eventOffset = eventOrder[orderIndex]!;
    if (ready[eventOffset] !== 1) {
      const eventId = graph.idAt(eventOffset) ?? String(eventOffset);
      throw new Error(
        `Critical replay planning requires topological order; event ${eventId} is not ready`,
      );
    }
    ready[eventOffset] = 0;
    readyCount--;

    const parentCount = graph.parentCountAt(eventOffset);
    const prefixFrontierSizeBefore = prefixFrontierSize;
    let parentsInPrefixFrontier = 0;

    // Removing the popped ready event from parent coverage and replacing its
    // parent frontier with the event used to require three complete parent
    // scans (plus a fourth at section starts). Fuse those updates while every
    // parent offset is hot: the arithmetic is identical because each term is
    // additive and uses readyCount after the pop plus coverage after removal.
    for (let parentIndex = 0; parentIndex < parentCount; parentIndex++) {
      const parentOffset = requireParentOffset(graph, eventOffset, parentIndex);
      const previousCoverage = readyParentCoverage[parentOffset]!;
      if (previousCoverage === 0) {
        throw new Error("Invalid packed replay ready-parent coverage");
      }
      const nextCoverage = previousCoverage - 1;
      readyParentCoverage[parentOffset] = nextCoverage;

      if (prefixFrontier[parentOffset] !== 1) {
        continue;
      }
      parentsInPrefixFrontier++;
      missingReadyParentPairs -= readyCount - nextCoverage;
      prefixFrontier[parentOffset] = 0;
      prefixFrontierSize--;
    }

    if (orderIndex === sectionStart) {
      sectionIsLinear =
        parentCount === prefixFrontierSizeBefore &&
        parentsInPrefixFrontier === prefixFrontierSizeBefore;
    } else if (
      parentCount !== 1 ||
      graph.parentOffsetAt(eventOffset, 0) !== eventOrder[orderIndex - 1]
    ) {
      sectionIsLinear = false;
    }

    missingReadyParentPairs -=
      prefixFrontierSizeBefore - parentsInPrefixFrontier;
    prefixFrontier[eventOffset] = 1;
    prefixFrontierSize++;
    missingReadyParentPairs += readyCount - readyParentCoverage[eventOffset]!;

    const childCount = graph.childCountAt(eventOffset);
    for (let childIndex = 0; childIndex < childCount; childIndex++) {
      const childOffset = requireChildOffset(graph, eventOffset, childIndex);
      const remaining = remainingParents[childOffset]! - 1;
      remainingParents[childOffset] = remaining;
      if (remaining !== 0) {
        continue;
      }

      const childParentCount = graph.parentCountAt(childOffset);
      let childParentsInPrefixFrontier = 0;
      for (let parentIndex = 0; parentIndex < childParentCount; parentIndex++) {
        const parentOffset = requireParentOffset(
          graph,
          childOffset,
          parentIndex,
        );
        if (prefixFrontier[parentOffset] === 1) {
          childParentsInPrefixFrontier++;
        }
        readyParentCoverage[parentOffset] =
          readyParentCoverage[parentOffset]! + 1;
      }
      missingReadyParentPairs +=
        prefixFrontierSize - childParentsInPrefixFrontier;
      ready[childOffset] = 1;
      readyCount++;
    }

    const isFinalFrontier = readyCount === 0;
    if (!isFinalFrontier && missingReadyParentPairs !== 0) {
      continue;
    }

    sectionEnds[sectionCount] = orderIndex + 1;
    linearSections[sectionCount] = sectionIsLinear ? 1 : 0;
    sectionCount++;
    sectionStart = orderIndex + 1;
  }

  if (sectionStart !== eventCount) {
    throw new Error("Packed critical replay plan did not cover every event");
  }

  for (let orderIndex = 0; orderIndex < eventCount; orderIndex++) {
    remainingParents[eventOrder[orderIndex]!] = orderIndex;
  }

  return new PackedCriticalReplayPlan(
    graph,
    eventOrder,
    remainingParents,
    sectionEnds.slice(0, sectionCount),
    linearSections.slice(0, sectionCount),
    sectionCount,
  );
};

const requireParentOffset = (
  graph: PackedReplayPlanningView,
  eventOffset: number,
  parentIndex: number,
): number => {
  const offset = graph.parentOffsetAt(eventOffset, parentIndex);
  if (offset === undefined) {
    throw new Error(
      `Packed replay graph is missing parent ${parentIndex} of event offset ${eventOffset}`,
    );
  }
  return offset;
};

const requireChildOffset = (
  graph: PackedReplayPlanningView,
  eventOffset: number,
  childIndex: number,
): number => {
  const offset = graph.childOffsetAt(eventOffset, childIndex);
  if (offset === undefined) {
    throw new Error(
      `Packed replay graph is missing child ${childIndex} of event offset ${eventOffset}`,
    );
  }
  return offset;
};
