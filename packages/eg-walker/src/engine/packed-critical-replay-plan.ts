import type {
  EventGraph,
  PackedReplayPlanningView,
} from "../graph/event-graph";
import type { EventId, GraphEvent } from "../types";
import type { ExternalOperation } from "../types";

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
  constructor(
    private readonly graph: PackedReplayPlanningView,
    private readonly eventOrder: Uint32Array,
    private readonly sectionEnds: Uint32Array,
    private readonly linearSections: Uint8Array,
    readonly sectionCount: number,
  ) {}

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
    const offset = this.eventOffsetAt(orderIndex);
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
    const start = this.sectionStartAt(sectionIndex);
    const end = this.sectionEndAt(sectionIndex);
    const events = new Array<GraphEvent>(end - start);
    for (let orderIndex = start; orderIndex < end; orderIndex++) {
      events[orderIndex - start] = this.eventAt(orderIndex);
    }
    return Object.freeze(events);
  }

  isInsertAt(orderIndex: number): boolean {
    return this.graph.isInsertAt(this.eventOffsetAt(orderIndex));
  }

  operationIndexAt(orderIndex: number): number {
    return this.graph.operationIndexAt(this.eventOffsetAt(orderIndex));
  }

  operationLengthAt(orderIndex: number): number {
    return this.graph.operationLengthAt(this.eventOffsetAt(orderIndex));
  }

  insertStartAt(orderIndex: number): number {
    return this.graph.insertStartAt(this.eventOffsetAt(orderIndex));
  }

  sliceInsertedContent(start: number, end: number): string {
    return this.graph.sliceInsertedContent(start, end);
  }

  private eventOffsetAt(orderIndex: number): number {
    if (
      !Number.isInteger(orderIndex) ||
      orderIndex < 0 ||
      orderIndex >= this.eventOrder.length
    ) {
      throw new RangeError(`Invalid packed replay order index ${orderIndex}`);
    }
    return this.eventOrder[orderIndex]!;
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
    if (orderIndex === sectionStart) {
      sectionIsLinear =
        parentCount === prefixFrontierSize &&
        countParentsInNumericFrontier(graph, eventOffset, prefixFrontier) ===
          prefixFrontierSize;
    } else if (
      parentCount !== 1 ||
      graph.parentOffsetAt(eventOffset, 0) !== eventOrder[orderIndex - 1]
    ) {
      sectionIsLinear = false;
    }

    missingReadyParentPairs -=
      prefixFrontierSize -
      countParentsInNumericFrontier(graph, eventOffset, prefixFrontier);
    adjustParentCoverage(graph, eventOffset, readyParentCoverage, -1);

    for (let parentIndex = 0; parentIndex < parentCount; parentIndex++) {
      const parentOffset = requireParentOffset(graph, eventOffset, parentIndex);
      if (prefixFrontier[parentOffset] !== 1) {
        continue;
      }
      missingReadyParentPairs -=
        readyCount - readyParentCoverage[parentOffset]!;
      prefixFrontier[parentOffset] = 0;
      prefixFrontierSize--;
    }
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

      missingReadyParentPairs +=
        prefixFrontierSize -
        countParentsInNumericFrontier(graph, childOffset, prefixFrontier);
      adjustParentCoverage(graph, childOffset, readyParentCoverage, 1);
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

  return new PackedCriticalReplayPlan(
    graph,
    eventOrder,
    sectionEnds.slice(0, sectionCount),
    linearSections.slice(0, sectionCount),
    sectionCount,
  );
};

const countParentsInNumericFrontier = (
  graph: PackedReplayPlanningView,
  eventOffset: number,
  frontier: Uint8Array,
): number => {
  const parentCount = graph.parentCountAt(eventOffset);
  let count = 0;
  for (let parentIndex = 0; parentIndex < parentCount; parentIndex++) {
    if (frontier[requireParentOffset(graph, eventOffset, parentIndex)] === 1) {
      count++;
    }
  }
  return count;
};

const adjustParentCoverage = (
  graph: PackedReplayPlanningView,
  eventOffset: number,
  coverage: Uint32Array,
  delta: 1 | -1,
): void => {
  const parentCount = graph.parentCountAt(eventOffset);
  for (let parentIndex = 0; parentIndex < parentCount; parentIndex++) {
    const parentOffset = requireParentOffset(graph, eventOffset, parentIndex);
    const previous = coverage[parentOffset]!;
    if (delta === -1 && previous === 0) {
      throw new Error("Invalid packed replay ready-parent coverage");
    }
    coverage[parentOffset] = previous + delta;
  }
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
