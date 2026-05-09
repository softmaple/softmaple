import { OPERATION_TYPE } from "../constants/operation-types";
import { EventGraph } from "../graph/event-graph";
import type { EventId, ExternalOperation, GraphEvent } from "../types";
import { IndexedSequence } from "./indexed-sequence";

const BASE_EVENT_ID_PREFIX = "__base__:";

interface AugmentedCRDTItem {
  readonly id: EventId;
  readonly eventId: EventId;
  readonly content: string;
  readonly originLeft: EventId | null;
  readonly originRight: EventId | null;
  everDeleted: boolean;
  prepareState: number;
}

interface EngineStats {
  readonly retreatCount: number;
  readonly advanceCount: number;
  readonly eventsProcessed: number;
}

export interface GeneratedDocument {
  readonly text: string;
  readonly transformedOperations: ReadonlyArray<ExternalOperation>;
  readonly stats: EngineStats;
}

export interface GenerateOptions {
  readonly initialVersion?: ReadonlySet<EventId>;
  readonly eventGraph?: EventGraph;
}

export interface IncrementalApplyResult {
  readonly text: string;
  readonly transformedOperations: ReadonlyArray<ExternalOperation>;
}

const compareIds = (left: EventId, right: EventId): number =>
  left.localeCompare(right);

const spliceText = (text: string, index: number, insertText: string): string =>
  `${text.slice(0, index)}${insertText}${text.slice(index)}`;

const deleteText = (text: string, index: number, length: number): string =>
  `${text.slice(0, index)}${text.slice(index + length)}`;

const stringCodeUnits = (text: string): string[] =>
  Array.from({ length: text.length }, (_, index) => text[index] ?? "");

/**
 * Direct implementation of the Eg-walker replay algorithm from Appendix B.
 *
 * The event graph and plain document text remain persistent state. This class is
 * temporary replay state: it creates augmented CRDT records with prepare-state
 * and effect-state, walks causal history, and then can be discarded.
 */
export class EgWalkerEngine {
  private readonly eventsById = new Map<EventId, GraphEvent>();
  private readonly eventOrder = new Map<EventId, number>();
  private graph = new EventGraph();
  private readonly eventItems = new Map<EventId, EventId[]>();
  private readonly deleteTargets = new Map<EventId, EventId[]>();
  private readonly itemsById = new Map<EventId, AugmentedCRDTItem>();
  private readonly insertionBuckets = new Map<string, EventId[]>();
  private readonly sequence = new IndexedSequence<AugmentedCRDTItem>(
    (item) => (item.prepareState === 1 ? 1 : 0),
    (item) => (item.everDeleted ? 0 : 1),
  );
  private currentVersion = new Set<EventId>();
  private resultingText = "";
  private retreatCount = 0;
  private advanceCount = 0;

  generate(
    events: ReadonlyArray<GraphEvent>,
    initialText: string = "",
    options: GenerateOptions = {},
  ): GeneratedDocument {
    this.reset(events, initialText, options);

    const transformedOperations: ExternalOperation[] = [];

    for (const event of events) {
      const transformed = this.processEvent(event);
      transformedOperations.push(...transformed);
    }

    return {
      text: this.resultingText,
      transformedOperations,
      stats: {
        retreatCount: this.retreatCount,
        advanceCount: this.advanceCount,
        eventsProcessed: events.length,
      },
    };
  }

  /**
   * Apply a single new event on top of the current engine state without
   * resetting. The caller must ensure {@link graph} is the up-to-date event
   * graph that already contains {@link event}.
   */
  applyEvent(event: GraphEvent, graph: EventGraph): IncrementalApplyResult {
    if (!this.eventsById.has(event.id)) {
      this.eventsById.set(event.id, event);
      this.eventOrder.set(event.id, this.eventOrder.size);
    }
    this.graph = graph;

    const transformed = this.processEvent(event);
    return {
      text: this.resultingText,
      transformedOperations: transformed,
    };
  }

  getText(): string {
    return this.resultingText;
  }

  getCurrentVersion(): ReadonlySet<EventId> {
    return this.currentVersion;
  }

  private processEvent(event: GraphEvent): ExternalOperation[] {
    const { retreat, advance } = this.diffVersions(
      this.currentVersion,
      event.parentVersion,
    );

    for (const eventId of retreat) {
      this.retreat(eventId);
    }
    for (const eventId of advance) {
      this.advance(eventId);
    }

    const transformed = this.apply(event);
    this.currentVersion = new Set([event.id]);
    return transformed;
  }

  private reset(
    events: ReadonlyArray<GraphEvent>,
    initialText: string,
    options: GenerateOptions,
  ): void {
    this.eventsById.clear();
    this.eventOrder.clear();
    this.graph = options.eventGraph ?? new EventGraph();
    this.eventItems.clear();
    this.deleteTargets.clear();
    this.itemsById.clear();
    this.insertionBuckets.clear();
    this.sequence.clear();
    this.currentVersion = new Set(options.initialVersion ?? []);
    this.resultingText = initialText;
    this.retreatCount = 0;
    this.advanceCount = 0;

    const graphEvents = options.eventGraph?.getTopologicalOrder() ?? events;
    graphEvents.forEach((event, index) => {
      this.eventsById.set(event.id, event);
      this.eventOrder.set(event.id, index);
      if (!options.eventGraph) {
        this.graph.addEvent(event);
      }
    });

    let originLeft: EventId | null = null;
    stringCodeUnits(initialText).forEach((content, index) => {
      const id = `${BASE_EVENT_ID_PREFIX}${index}`;
      const item: AugmentedCRDTItem = {
        id,
        eventId: BASE_EVENT_ID_PREFIX,
        content,
        originLeft,
        originRight: null,
        everDeleted: false,
        prepareState: 1,
      };
      this.sequence.push(item);
      this.itemsById.set(id, item);
      originLeft = id;
    });
  }

  private apply(event: GraphEvent): ExternalOperation[] {
    const operation = event.operation;

    if (operation.type === OPERATION_TYPE.INSERT) {
      return this.applyInsert(event, operation);
    }

    return this.applyDelete(event, operation);
  }

  private applyInsert(
    event: GraphEvent,
    operation: Extract<
      ExternalOperation,
      { type: typeof OPERATION_TYPE.INSERT }
    >,
  ): ExternalOperation[] {
    if (operation.text.length === 0) {
      this.eventItems.set(event.id, []);
      return [];
    }

    const firstInsertPosition = this.prepareIndexToItemPosition(
      operation.index,
      true,
    );
    const originLeft = this.sequence.at(firstInsertPosition - 1)?.id ?? null;
    const originRightPosition =
      this.sequence.nextPrepareVisiblePosition(firstInsertPosition);
    const originRight =
      originRightPosition === null
        ? null
        : (this.sequence.at(originRightPosition)?.id ?? null);
    const insertedIds: EventId[] = [];
    let left = originLeft;

    for (const [offset, content] of stringCodeUnits(operation.text).entries()) {
      const item: AugmentedCRDTItem = {
        id: `${event.id}:${offset}`,
        eventId: event.id,
        content,
        originLeft: left,
        originRight,
        everDeleted: false,
        prepareState: 1,
      };
      this.integrate(item);
      this.itemsById.set(item.id, item);
      insertedIds.push(item.id);
      left = item.id;
    }

    this.eventItems.set(event.id, insertedIds);

    const firstInserted = this.requireItem(insertedIds[0] ?? event.id);
    const effectIndex = this.itemToEffectIndex(firstInserted);
    this.resultingText = spliceText(
      this.resultingText,
      effectIndex,
      operation.text,
    );

    return [
      {
        type: OPERATION_TYPE.INSERT,
        index: effectIndex,
        text: operation.text,
      },
    ];
  }

  private applyDelete(
    event: GraphEvent,
    operation: Extract<
      ExternalOperation,
      { type: typeof OPERATION_TYPE.DELETE }
    >,
  ): ExternalOperation[] {
    const deletedItemIds: EventId[] = [];
    const outputDeleteIndexes: number[] = [];

    for (let i = 0; i < operation.length; i++) {
      const target = this.findVisiblePrepareItem(operation.index);
      if (!target) {
        break;
      }

      deletedItemIds.push(target.id);

      if (!target.everDeleted) {
        const effectIndex = this.itemToEffectIndex(target);
        outputDeleteIndexes.push(effectIndex);
        this.resultingText = deleteText(this.resultingText, effectIndex, 1);
      }

      target.everDeleted = true;
      target.prepareState += 1;
      this.sequence.updateItem(target);
    }

    this.deleteTargets.set(event.id, deletedItemIds);

    return coalesceDeleteRuns(outputDeleteIndexes);
  }

  private retreat(eventId: EventId): void {
    const event = this.eventsById.get(eventId);
    if (!event) {
      return;
    }

    if (event.operation.type === OPERATION_TYPE.INSERT) {
      for (const itemId of this.eventItems.get(eventId) ?? []) {
        const item = this.requireItem(itemId);
        item.prepareState -= 1;
        this.sequence.updateItem(item);
      }
    } else {
      for (const itemId of this.deleteTargets.get(eventId) ?? []) {
        const item = this.requireItem(itemId);
        item.prepareState -= 1;
        this.sequence.updateItem(item);
      }
    }

    this.retreatCount++;
  }

  private advance(eventId: EventId): void {
    const event = this.eventsById.get(eventId);
    if (!event) {
      return;
    }

    if (event.operation.type === OPERATION_TYPE.INSERT) {
      for (const itemId of this.eventItems.get(eventId) ?? []) {
        const item = this.requireItem(itemId);
        item.prepareState += 1;
        this.sequence.updateItem(item);
      }
    } else {
      for (const itemId of this.deleteTargets.get(eventId) ?? []) {
        const item = this.requireItem(itemId);
        item.prepareState += 1;
        this.sequence.updateItem(item);
      }
    }

    this.advanceCount++;
  }

  private integrate(item: AugmentedCRDTItem): void {
    if (this.itemsById.has(item.id)) {
      return;
    }

    const position = this.findIntegrationPosition(item);
    this.sequence.insert(position, item);
    this.addToInsertionBucket(item);
  }

  private findIntegrationPosition(item: AugmentedCRDTItem): number {
    const leftItem = item.originLeft
      ? this.itemsById.get(item.originLeft)
      : undefined;
    const rightItem = item.originRight
      ? this.itemsById.get(item.originRight)
      : undefined;
    const leftIndex = leftItem ? this.sequence.positionOf(leftItem) : -1;
    const rightIndex = rightItem
      ? this.sequence.positionOf(rightItem)
      : this.sequence.length;
    const lowerBound = leftIndex + 1;
    const upperBound = rightIndex === -1 ? this.sequence.length : rightIndex;
    const bucket = this.insertionBuckets.get(this.originKey(item));
    if (bucket) {
      for (const itemId of bucket) {
        const current = this.itemsById.get(itemId);
        if (!current) {
          continue;
        }

        const currentPosition = this.sequence.positionOf(current);
        if (currentPosition < lowerBound || currentPosition >= upperBound) {
          continue;
        }

        if (compareIds(item.eventId, current.eventId) < 0) {
          return currentPosition;
        }
      }
    }
    return upperBound;
  }

  private addToInsertionBucket(item: AugmentedCRDTItem): void {
    const key = this.originKey(item);
    const bucket = this.insertionBuckets.get(key) ?? [];
    const insertionIndex = bucket.findIndex((itemId) => {
      const current = this.itemsById.get(itemId);
      return current ? compareIds(item.eventId, current.eventId) < 0 : false;
    });

    if (insertionIndex === -1) {
      bucket.push(item.id);
    } else {
      bucket.splice(insertionIndex, 0, item.id);
    }
    this.insertionBuckets.set(key, bucket);
  }

  private originKey(item: AugmentedCRDTItem): string {
    // Event IDs are "<replicaId>:<n>" so they cannot contain NUL — safe delimiter.
    return `${item.originLeft ?? ""} ${item.originRight ?? ""}`;
  }

  private prepareIndexToItemPosition(index: number, allowEnd: boolean): number {
    return this.sequence.prepareIndexToPosition(index, allowEnd);
  }

  private findVisiblePrepareItem(index: number): AugmentedCRDTItem | undefined {
    try {
      const position = this.prepareIndexToItemPosition(index, false);
      return this.sequence.at(position);
    } catch {
      return undefined;
    }
  }

  private itemToEffectIndex(target: AugmentedCRDTItem): number {
    const position = this.sequence.positionOf(target);
    if (position === -1) {
      throw new Error(`Item ${target.id} not found`);
    }
    return this.sequence.effectIndexBeforePosition(position);
  }

  private diffVersions(
    currentVersion: ReadonlySet<EventId>,
    targetVersion: ReadonlySet<EventId>,
  ): { retreat: EventId[]; advance: EventId[] } {
    const { onlyInLeft, onlyInRight } = this.graph.diffVersions(
      currentVersion,
      targetVersion,
    );

    const retreat = Array.from(onlyInLeft).sort((left, right) =>
      this.compareByTopologicalOrder(right, left),
    );
    const advance = Array.from(onlyInRight).sort((left, right) =>
      this.compareByTopologicalOrder(left, right),
    );

    return { retreat, advance };
  }

  private compareByTopologicalOrder(left: EventId, right: EventId): number {
    const leftOrder = this.eventOrder.get(left) ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = this.eventOrder.get(right) ?? Number.MAX_SAFE_INTEGER;
    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }
    return compareIds(left, right);
  }

  private requireItem(itemId: EventId): AugmentedCRDTItem {
    const item = this.itemsById.get(itemId);
    if (!item) {
      throw new Error(`CRDT item ${itemId} not found`);
    }
    return item;
  }
}

/**
 * Coalesce a sequence of in-order effect-index deletes into the smallest list
 * of {index, length} operations that, applied in order, produces the same
 * deletes. Two consecutive deletes are contiguous when the second targets the
 * same effect index as the first (the next character shifted into the slot).
 */
const coalesceDeleteRuns = (
  effectIndexes: ReadonlyArray<number>,
): ExternalOperation[] => {
  const runs: ExternalOperation[] = [];
  let runStart = -1;
  let runLength = 0;

  for (const index of effectIndexes) {
    if (runLength === 0) {
      runStart = index;
      runLength = 1;
      continue;
    }

    if (index === runStart) {
      runLength += 1;
      continue;
    }

    runs.push({
      type: OPERATION_TYPE.DELETE,
      index: runStart,
      length: runLength,
    });
    runStart = index;
    runLength = 1;
  }

  if (runLength > 0) {
    runs.push({
      type: OPERATION_TYPE.DELETE,
      index: runStart,
      length: runLength,
    });
  }

  return runs;
};
