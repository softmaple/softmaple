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
import { runSteps, type Steps } from "../graph/internals/steps";

/** {@link PackedCriticalReplayPlan.orderIndexOfKnownOffset} of an event outside the plan. */
const OUTSIDE_PLAN_ORDER_INDEX = 0xffff_ffff;

/**
 * Critical-section cuts over a packed graph without per-section objects.
 *
 * Section bounds index into one branch-preserving numeric event order. A
 * section's base frontier is always the previous cut's end frontier, so the
 * executor can carry that frontier forward instead of storing a copy at every
 * cut. In practice most paper traces have hundreds of thousands of singleton
 * cuts; this representation needs five bytes per possible cut rather than an
 * object, an event slice, and two Sets.
 *
 * Offsets taken and returned by the `*Offset*` methods, and by
 * {@link eventOffsetAt}, are the event graph's local versions. A plan over a
 * whole graph reads them straight from its view. A plan over the events after
 * a critical cut ({@link planPackedSuffixCriticalReplaySections}) reads a view
 * whose offset 0 stands for the whole prefix and whose offset `k` is local
 * version `offsetBase + k`; it translates at this boundary, so replay engines
 * address the same events either way.
 */
export class PackedCriticalReplayPlan {
  private readonly numericFrontier: Uint8Array;
  private readonly numericBaseOffsets: number[] = [];
  private readonly localVersionScratch: number[] = [];
  private shiftedTransition: ShiftedLocalVersionTransition | null = null;

  constructor(
    private readonly graph: PackedReplayPlanningView,
    private readonly eventOrder: Uint32Array,
    private readonly rankByOffset: Uint32Array,
    private readonly sectionEnds: Uint32Array,
    private readonly linearSections: Uint8Array,
    readonly sectionCount: number,
    /** Runs the planner visited; it scanned edges once per run. */
    readonly runCount: number,
    /**
     * Local version of the view's offset 0. A suffix view's offset 0 is the
     * last event before the cut and stands for every event before it.
     */
    private readonly offsetBase: number = 0,
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
    return this.eventIdAtViewOffset(this.viewOffsetAt(orderIndex));
  }

  eventIdAtOffset(offset: number): EventId {
    const viewOffset = offset - this.offsetBase;
    this.assertViewOffset(viewOffset);
    return this.eventIdAtViewOffset(viewOffset);
  }

  /**
   * @internal Agent of the event at `offset`, or `-1` when its ID is not a
   * canonical `replicaId:sequence`. Offsets are the graph's local versions.
   */
  agentAtKnownOffset(offset: number): number {
    return this.graph.agentAt(offset - this.offsetBase);
  }

  /** @internal Sequence of the event at `offset`. */
  sequenceAtKnownOffset(offset: number): number {
    return this.graph.sequenceAt(offset - this.offsetBase);
  }

  /** @internal `offset` must originate from this plan or one of its diffs. */
  eventIdAtKnownOffset(offset: number): EventId {
    return this.eventIdAtViewOffset(offset - this.offsetBase);
  }

  eventAt(orderIndex: number): GraphEvent {
    const offset = this.viewOffsetAt(orderIndex);
    const event = this.graph.eventAt(offset);
    if (event === undefined) {
      throw new Error(
        `Packed replay plan is missing event at offset ${offset + this.offsetBase}`,
      );
    }
    return event;
  }

  operationAt(orderIndex: number): ExternalOperation {
    return this.graph.operationAt(this.viewOffsetAt(orderIndex));
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
      if (offset === 0 && this.offsetBase !== 0) {
        // Every ID before a suffix plan's cut is its offset 0. The range
        // follows the cut, so it leaves none of them in the frontier.
        continue;
      }
      marks[offset] = 1;
      baseOffsets.push(offset);
    }

    try {
      for (let orderIndex = start; orderIndex < end; orderIndex++) {
        const eventOffset = this.viewOffsetAt(orderIndex);
        const parentCount = this.graph.parentCountAt(eventOffset);
        for (let parentIndex = 0; parentIndex < parentCount; parentIndex++) {
          const parentOffset = this.graph.parentOffsetAt(
            eventOffset,
            parentIndex,
          );
          if (parentOffset === undefined) {
            throw new Error(
              `Packed replay event ${eventOffset + this.offsetBase} is missing parent ${parentIndex}`,
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
          frontier.add(this.eventIdAtViewOffset(offset));
        }
      }
      for (let orderIndex = start; orderIndex < end; orderIndex++) {
        const eventOffset = this.viewOffsetAt(orderIndex);
        if (marks[eventOffset] === 1) {
          frontier.add(this.eventIdAtViewOffset(eventOffset));
        }
      }
      return frontier;
    } finally {
      for (let index = 0; index < baseOffsets.length; index++) {
        marks[baseOffsets[index]!] = 0;
      }
      for (let orderIndex = start; orderIndex < end; orderIndex++) {
        marks[this.viewOffsetAt(orderIndex)] = 0;
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
    const viewOffset = eventOffset - this.offsetBase;
    const viewVersion =
      this.offsetBase === 0 ? version : this.viewVersionOf(version);
    const parentCount = this.graph.parentCountAt(viewOffset);
    if (parentCount !== viewVersion.length) {
      return false;
    }
    for (let parentIndex = 0; parentIndex < parentCount; parentIndex++) {
      const parentOffset = this.graph.parentOffsetAt(viewOffset, parentIndex);
      if (parentOffset === undefined || !viewVersion.includes(parentOffset)) {
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
    if (this.offsetBase === 0) {
      return this.graph.diffLocalVersionsToParentRanges(
        currentVersion,
        targetEventOffset,
      );
    }
    return this.shiftTransition(
      this.graph.diffLocalVersionsToParentRanges(
        this.viewVersionOf(currentVersion),
        targetEventOffset - this.offsetBase,
      ),
    );
  }

  /** @internal Both offsets must originate from this plan. */
  hasSingleParentAtKnownOffset(
    eventOffset: number,
    parentOffset: number,
  ): boolean {
    return this.graph.runs.hasSingleParent(
      eventOffset - this.offsetBase,
      this.viewOffsetOf(parentOffset),
    );
  }

  orderIndexOfOffset(offset: number): number {
    const viewOffset = offset - this.offsetBase;
    this.assertViewOffset(viewOffset);
    return this.rankByOffset[viewOffset]!;
  }

  /**
   * @internal `offset` must originate from this plan or one of its diffs.
   * An offset before a suffix plan's cut has no order index of its own and
   * answers one past every order index, so range checks skip it.
   */
  orderIndexOfKnownOffset(offset: number): number {
    const viewOffset = offset - this.offsetBase;
    return viewOffset > 0 || this.offsetBase === 0
      ? this.rankByOffset[viewOffset]!
      : OUTSIDE_PLAN_ORDER_INDEX;
  }

  /** @internal `offset` must originate from this plan or one of its diffs. */
  isInsertAtKnownOffset(offset: number): boolean {
    return this.graph.isInsertAt(offset - this.offsetBase);
  }

  /** @internal `targetEventOffset` must originate from this plan. */
  transitionFromVersionToKnownOffset(
    currentVersion: ReadonlySet<EventId>,
    targetEventOffset: number,
  ): PackedOffsetTransition {
    this.assertWholeGraphPlan("transitionFromVersionToKnownOffset");
    return this.graph.diffVersionToParents(currentVersion, targetEventOffset);
  }

  /** @internal `targetEventOffset` must originate from this plan. */
  transitionRangesFromVersionToKnownOffset(
    currentVersion: ReadonlySet<EventId>,
    targetEventOffset: number,
  ): PackedLocalVersionTransition {
    if (this.offsetBase === 0) {
      return this.graph.diffVersionToParentRanges(
        currentVersion,
        targetEventOffset,
      );
    }
    return this.shiftTransition(
      this.graph.diffVersionToParentRanges(
        currentVersion,
        targetEventOffset - this.offsetBase,
      ),
    );
  }

  /** @internal Both offsets must originate from this plan. */
  transitionBetweenKnownOffsets(
    currentOffset: number,
    targetEventOffset: number,
  ): PackedOffsetTransition {
    this.assertWholeGraphPlan("transitionBetweenKnownOffsets");
    return this.graph.diffOffsetToParents(currentOffset, targetEventOffset);
  }

  /** @internal Both offsets must originate from this plan. */
  transitionRangesBetweenKnownOffsets(
    currentOffset: number,
    targetEventOffset: number,
  ): PackedLocalVersionTransition {
    if (this.offsetBase === 0) {
      return this.graph.diffOffsetToParentRanges(
        currentOffset,
        targetEventOffset,
      );
    }
    return this.shiftTransition(
      this.graph.diffOffsetToParentRanges(
        this.viewOffsetOf(currentOffset),
        targetEventOffset - this.offsetBase,
      ),
    );
  }

  isInsertAt(orderIndex: number): boolean {
    return this.graph.isInsertAt(this.viewOffsetAt(orderIndex));
  }

  operationIndexAt(orderIndex: number): number {
    return this.graph.operationIndexAt(this.viewOffsetAt(orderIndex));
  }

  operationLengthAt(orderIndex: number): number {
    return this.graph.operationLengthAt(this.viewOffsetAt(orderIndex));
  }

  insertStartAt(orderIndex: number): number {
    return this.graph.insertStartAt(this.viewOffsetAt(orderIndex));
  }

  /** @internal `offset` must originate from this plan. */
  operationIndexAtKnownOffset(offset: number): number {
    return this.graph.operationIndexAt(offset - this.offsetBase);
  }

  /** @internal `offset` must originate from this plan. */
  operationLengthAtKnownOffset(offset: number): number {
    return this.graph.operationLengthAt(offset - this.offsetBase);
  }

  /** @internal `offset` must originate from this plan. */
  insertStartAtKnownOffset(offset: number): number {
    return this.graph.insertStartAt(offset - this.offsetBase);
  }

  sliceInsertedContent(start: number, end: number): string {
    return this.graph.sliceInsertedContent(start, end);
  }

  /** The graph's local version of the event at `orderIndex`. */
  eventOffsetAt(orderIndex: number): number {
    return this.viewOffsetAt(orderIndex) + this.offsetBase;
  }

  private viewOffsetAt(orderIndex: number): number {
    if (
      !Number.isInteger(orderIndex) ||
      orderIndex < 0 ||
      orderIndex >= this.eventOrder.length
    ) {
      throw new RangeError(`Invalid packed replay order index ${orderIndex}`);
    }
    return this.eventOrder[orderIndex]!;
  }

  private eventIdAtViewOffset(viewOffset: number): EventId {
    const id = this.graph.idAt(viewOffset);
    if (id === undefined) {
      throw new Error(
        `Packed replay plan is missing event at offset ${viewOffset + this.offsetBase}`,
      );
    }
    return id;
  }

  /** A local version as a view offset; the prefix before a cut is offset 0. */
  private viewOffsetOf(localVersion: number): number {
    const viewOffset = localVersion - this.offsetBase;
    return viewOffset > 0 ? viewOffset : 0;
  }

  /**
   * A version as view offsets, without repeats: the prefix events of a
   * checkpoint's frontier all become offset 0. The array is reused.
   */
  private viewVersionOf(version: ReadonlyArray<number>): ReadonlyArray<number> {
    const viewVersion = this.localVersionScratch;
    viewVersion.length = 0;
    for (let index = 0; index < version.length; index++) {
      const viewOffset = this.viewOffsetOf(version[index]!);
      if (!viewVersion.includes(viewOffset)) {
        viewVersion.push(viewOffset);
      }
    }
    return viewVersion;
  }

  private shiftTransition(
    transition: PackedLocalVersionTransition,
  ): PackedLocalVersionTransition {
    this.shiftedTransition ??= new ShiftedLocalVersionTransition();
    return this.shiftedTransition.assign(transition, this.offsetBase);
  }

  private assertWholeGraphPlan(method: string): void {
    if (this.offsetBase !== 0) {
      throw new Error(`${method} is not available on a suffix replay plan`);
    }
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

  private assertViewOffset(viewOffset: number): void {
    if (
      !Number.isInteger(viewOffset) ||
      viewOffset < 0 ||
      viewOffset >= this.eventCount
    ) {
      throw new RangeError(
        `Invalid packed replay event offset ${viewOffset + this.offsetBase}`,
      );
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
 * A suffix view's transition in local versions. The view's offset 0 stands
 * for the prefix, which every version of the suffix contains, so it is never
 * one-sided; it is dropped all the same rather than shifted onto a real event.
 */
class ShiftedLocalVersionTransition implements PackedLocalVersionTransition {
  retreatStarts: Uint32Array = new Uint32Array(16);
  retreatEnds: Uint32Array = new Uint32Array(16);
  retreatRangeCount = 0;
  retreatEventCount = 0;
  advanceStarts: Uint32Array = new Uint32Array(16);
  advanceEnds: Uint32Array = new Uint32Array(16);
  advanceRangeCount = 0;
  advanceEventCount = 0;

  assign(source: PackedLocalVersionTransition, shift: number): this {
    if (this.retreatStarts.length < source.retreatRangeCount) {
      this.retreatStarts = new Uint32Array(source.retreatRangeCount * 2);
      this.retreatEnds = new Uint32Array(source.retreatRangeCount * 2);
    }
    if (this.advanceStarts.length < source.advanceRangeCount) {
      this.advanceStarts = new Uint32Array(source.advanceRangeCount * 2);
      this.advanceEnds = new Uint32Array(source.advanceRangeCount * 2);
    }
    let retreatCount = 0;
    let retreatEvents = 0;
    for (let range = 0; range < source.retreatRangeCount; range++) {
      const start = Math.max(1, source.retreatStarts[range]!);
      const end = source.retreatEnds[range]!;
      if (start < end) {
        this.retreatStarts[retreatCount] = start + shift;
        this.retreatEnds[retreatCount] = end + shift;
        retreatCount++;
        retreatEvents += end - start;
      }
    }
    let advanceCount = 0;
    let advanceEvents = 0;
    for (let range = 0; range < source.advanceRangeCount; range++) {
      const start = Math.max(1, source.advanceStarts[range]!);
      const end = source.advanceEnds[range]!;
      if (start < end) {
        this.advanceStarts[advanceCount] = start + shift;
        this.advanceEnds[advanceCount] = end + shift;
        advanceCount++;
        advanceEvents += end - start;
      }
    }
    this.retreatRangeCount = retreatCount;
    this.retreatEventCount = retreatEvents;
    this.advanceRangeCount = advanceCount;
    this.advanceEventCount = advanceEvents;
    return this;
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
): PackedCriticalReplayPlan | null =>
  runSteps(
    planPackedCriticalReplaySectionsSteps(source, Number.POSITIVE_INFINITY),
  );

/**
 * {@link planPackedCriticalReplaySections} in steps of `runsPerStep` graph
 * runs, for a caller that must pause between them.
 */
export function* planPackedCriticalReplaySectionsSteps(
  source: EventGraph,
  runsPerStep: number,
): Steps<PackedCriticalReplayPlan | null> {
  const graph = source.getPackedReplayPlanningView();
  if (graph === null) {
    return null;
  }
  const layout =
    yield* graph.buildBranchPreservingCriticalReplayLayoutSteps(runsPerStep);

  return new PackedCriticalReplayPlan(
    graph,
    layout.eventOrder,
    layout.rankByOffset,
    layout.sectionEnds,
    layout.linearSections,
    layout.sectionCount,
    layout.runCount,
  );
}

/**
 * Plan the replay of the events after a critical cut, over a packed view of
 * those events alone ({@link EventGraph.getPackedSuffixReplayView}).
 *
 * The cut must be critical: every event after the first `prefixEventCount`
 * in insertion order descends from every event of the prefix's frontier, as
 * for a trusted checkpoint. The view stands for the prefix with its last
 * event, so the plan's first section is that one event, which callers do not
 * replay; the sections after it cover every event after the cut. Planning
 * costs the suffix, not the graph. Returns `null` when the graph has no such
 * view.
 */
export const planPackedSuffixCriticalReplaySections = (
  source: EventGraph,
  prefixEventCount: number,
): PackedCriticalReplayPlan | null => {
  const graph = source.getPackedSuffixReplayView(prefixEventCount);
  if (graph === null) {
    return null;
  }
  const layout = graph.buildBranchPreservingCriticalReplayLayout();
  if (layout.sectionCount === 0 || layout.eventOrder[0] !== 0) {
    throw new Error("A suffix replay plan must start with its prefix event");
  }
  let sectionEnds = layout.sectionEnds;
  let linearSections = layout.linearSections;
  let sectionCount = layout.sectionCount;
  if (sectionEnds[0] !== 1) {
    // The cut after the prefix event is critical by definition, but a view
    // that is one chain is planned as a single section. Split it there.
    sectionEnds = new Uint32Array(sectionCount + 1);
    sectionEnds[0] = 1;
    sectionEnds.set(layout.sectionEnds, 1);
    linearSections = new Uint8Array(sectionCount + 1);
    linearSections[0] = 1;
    linearSections.set(layout.linearSections, 1);
    sectionCount++;
  }
  return new PackedCriticalReplayPlan(
    graph,
    layout.eventOrder,
    layout.rankByOffset,
    sectionEnds,
    linearSections,
    sectionCount,
    layout.runCount,
    prefixEventCount - 1,
  );
};
