import { OPERATION_TYPE } from "../constants/operation-types";
import { EventGraph } from "../graph/event-graph";
import { compareEventIds } from "../graph/event-id";
import type { EventId, ExternalOperation, GraphEvent } from "../types";
import { IndexedSequence } from "./indexed-sequence";

const BASE_EVENT_ID_PREFIX = "__base__:";
const PLACEHOLDER_EVENT_ID = "__placeholder__";
const PLACEHOLDER_ID_PREFIX = "__placeholder__:";

/**
 * Augmented CRDT item used during replay.
 *
 * Regular items represent a single UTF-16 code unit (`content.length === 1`).
 * Placeholder items represent a contiguous run of pre-checkpoint content for
 * Section 3.6 partial replay — they can carry `content.length > 1` and are
 * split on demand when an insert or delete lands inside them.
 *
 * `content` is mutable to support in-place placeholder splits without
 * invalidating the `WeakMap` location index in {@link IndexedSequence}.
 */
interface AugmentedCRDTItem {
  readonly id: EventId;
  readonly eventId: EventId;
  content: string;
  originLeft: EventId | null;
  readonly originRight: EventId | null;
  everDeleted: boolean;
  prepareState: number;
}

const isPlaceholder = (item: AugmentedCRDTItem): boolean =>
  item.eventId === PLACEHOLDER_EVENT_ID;

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

const spliceText = (text: string, index: number, insertText: string): string =>
  `${text.slice(0, index)}${insertText}${text.slice(index)}`;

const deleteText = (text: string, index: number, length: number): string =>
  `${text.slice(0, index)}${text.slice(index + length)}`;

/**
 * Split a string into JS UTF-16 code units, one per array slot. Unlike
 * `Array.from(text)` (which iterates code points and would coalesce a
 * surrogate pair into one entry), this preserves the public-API code-unit
 * indexing on which the CRDT items are keyed.
 */
const stringCodeUnits = (text: string): string[] => text.split("");

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
  // Reverse index: `target item id` -> set of item ids whose `originLeft`
  // points at it. Maintained alongside {@link itemsById} so that
  // {@link splitRecordAt} can cheaply rewrite the `originLeft` references
  // when it carves a placeholder in two. Without this rewrite the YATA
  // integration scan would see siblings anchored to the same logical
  // boundary as if they had different origins, which breaks partial
  // replay convergence.
  private readonly originLeftRefs = new Map<EventId, Set<EventId>>();
  private readonly sequence = new IndexedSequence<AugmentedCRDTItem>(
    (item) => (item.prepareState === 1 ? item.content.length : 0),
    (item) => (item.everDeleted ? 0 : item.content.length),
  );
  private currentVersion = new Set<EventId>();
  private resultingText = "";
  private retreatCount = 0;
  private advanceCount = 0;
  private placeholderCounter = 0;

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

  getStats(): EngineStats {
    return {
      retreatCount: this.retreatCount,
      advanceCount: this.advanceCount,
      eventsProcessed: this.eventsById.size,
    };
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
    this.originLeftRefs.clear();
    this.sequence.clear();
    this.currentVersion = new Set(options.initialVersion ?? []);
    this.resultingText = initialText;
    this.retreatCount = 0;
    this.advanceCount = 0;
    this.placeholderCounter = 0;

    const graphEvents = options.eventGraph?.getTopologicalOrder() ?? events;
    graphEvents.forEach((event, index) => {
      this.eventsById.set(event.id, event);
      this.eventOrder.set(event.id, index);
      if (!options.eventGraph) {
        this.graph.addEvent(event);
      }
    });

    if (initialText.length === 0) {
      return;
    }

    // Section 3.6 partial replay: when a checkpoint version is supplied, the
    // pre-checkpoint text is collapsed into a single placeholder record. Inserts
    // and deletes split the placeholder on demand, so this stays O(replayed
    // events) in memory rather than O(checkpoint length).
    const startFromCheckpoint = (options.initialVersion?.size ?? 0) > 0;
    if (startFromCheckpoint) {
      const placeholder: AugmentedCRDTItem = {
        id: this.nextPlaceholderId(),
        eventId: PLACEHOLDER_EVENT_ID,
        content: initialText,
        originLeft: null,
        originRight: null,
        everDeleted: false,
        prepareState: 1,
      };
      this.sequence.push(placeholder);
      this.itemsById.set(placeholder.id, placeholder);
      return;
    }

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
      this.trackOriginLeft(id, item.originLeft);
      originLeft = id;
    });
  }

  private nextPlaceholderId(): EventId {
    return `${PLACEHOLDER_ID_PREFIX}${this.placeholderCounter++}`;
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

    const landing = this.sequence.prepareIndexToPositionAndOffset(
      operation.index,
      true,
    );
    const firstInsertPosition =
      landing.offsetInRecord > 0
        ? this.splitRecordAt(landing.position, landing.offsetInRecord)
        : landing.position;
    // YATA-style origins: anchor against the records visible in the
    // event's parent version (prepare-state >= 1), NOT against whichever
    // concurrent records happen to be sitting in the sequence right now.
    // Without this filter the engine would assign different origins to
    // the same event depending on which concurrent siblings were
    // integrated first, breaking traversal-order independence.
    const originLeftPosition =
      this.sequence.previousPrepareVisiblePosition(firstInsertPosition);
    const originLeft =
      originLeftPosition === null
        ? null
        : (this.sequence.at(originLeftPosition)?.id ?? null);
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
      this.trackOriginLeft(item.id, item.originLeft);
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
    let remaining = operation.length;

    while (remaining > 0) {
      const landing = this.prepareIndexLanding(operation.index, false);
      if (!landing) {
        break;
      }
      const candidate = this.sequence.at(landing.position);
      if (!candidate) {
        break;
      }

      if (isPlaceholder(candidate) && candidate.content.length > 1) {
        const availableInRecord =
          candidate.content.length - landing.offsetInRecord;
        const toDelete = Math.min(remaining, availableInRecord);
        const middle = this.splitPlaceholderForDelete(
          landing.position,
          landing.offsetInRecord,
          toDelete,
        );

        deletedItemIds.push(middle.id);
        // Mirror the non-placeholder guard: a concurrent delete that lands on
        // an already-effect-deleted placeholder segment (e.g. after retreating
        // an overlapping sibling) must NOT remove characters from the text
        // again. Without this, two concurrent deletes of the same checkpoint
        // region replay to a shorter string than full replay produces.
        if (!middle.everDeleted) {
          const effectIndex = this.itemToEffectIndex(middle);
          for (let k = 0; k < toDelete; k++) {
            outputDeleteIndexes.push(effectIndex);
          }
          this.resultingText = deleteText(
            this.resultingText,
            effectIndex,
            toDelete,
          );
        }

        middle.everDeleted = true;
        middle.prepareState += 1;
        this.sequence.updateItem(middle);
        remaining -= toDelete;
        continue;
      }

      deletedItemIds.push(candidate.id);
      if (!candidate.everDeleted) {
        const effectIndex = this.itemToEffectIndex(candidate);
        outputDeleteIndexes.push(effectIndex);
        this.resultingText = deleteText(this.resultingText, effectIndex, 1);
      }
      candidate.everDeleted = true;
      candidate.prepareState += 1;
      this.sequence.updateItem(candidate);
      remaining -= 1;
    }

    this.deleteTargets.set(event.id, deletedItemIds);

    return coalesceDeleteRuns(outputDeleteIndexes);
  }

  /**
   * Split a multi-character placeholder so that `offsetInRecord` code units
   * remain in place and the rest become a new record at `position + 1`.
   * Returns the position of the new right-hand record — i.e. where neighbours
   * sandwiched between the two halves should be inserted. Single-character
   * records and offset-0 calls are no-ops.
   */
  private splitRecordAt(position: number, offsetInRecord: number): number {
    const left = this.sequence.at(position);
    if (!left || offsetInRecord <= 0 || offsetInRecord >= left.content.length) {
      return position + (offsetInRecord > 0 ? 1 : 0);
    }

    const rightContent = left.content.slice(offsetInRecord);
    left.content = left.content.slice(0, offsetInRecord);
    this.sequence.updateItem(left);

    const right: AugmentedCRDTItem = {
      id: this.nextPlaceholderId(),
      eventId: PLACEHOLDER_EVENT_ID,
      content: rightContent,
      originLeft: null,
      originRight: null,
      everDeleted: left.everDeleted,
      prepareState: left.prepareState,
    };
    this.sequence.insert(position + 1, right);
    this.itemsById.set(right.id, right);

    // Existing items with `originLeft = left.id` were anchored to the
    // right boundary of the pre-split record; that boundary now lives
    // at the end of {@link right}, so transfer their `originLeft`
    // references over. `originRight = left.id` references still point
    // at the left edge of the original record, which is unchanged.
    this.rewriteOriginLeftReferences(left.id, right.id);
    return position + 1;
  }

  private trackOriginLeft(itemId: EventId, originLeft: EventId | null): void {
    if (originLeft === null) {
      return;
    }
    const set = this.originLeftRefs.get(originLeft) ?? new Set<EventId>();
    set.add(itemId);
    this.originLeftRefs.set(originLeft, set);
  }

  private rewriteOriginLeftReferences(
    oldOriginLeft: EventId,
    newOriginLeft: EventId,
  ): void {
    const refs = this.originLeftRefs.get(oldOriginLeft);
    if (!refs || refs.size === 0) {
      return;
    }
    this.originLeftRefs.delete(oldOriginLeft);
    const merged = this.originLeftRefs.get(newOriginLeft) ?? new Set<EventId>();
    for (const itemId of refs) {
      const item = this.itemsById.get(itemId);
      if (!item || item.originLeft !== oldOriginLeft) {
        continue;
      }
      item.originLeft = newOriginLeft;
      merged.add(itemId);
    }
    if (merged.size > 0) {
      this.originLeftRefs.set(newOriginLeft, merged);
    }
  }

  /**
   * Split a placeholder so that the `length` code units starting at
   * `offsetInRecord` become an isolated record that the caller can mark as
   * deleted. Returns that middle record. Surrounding prefix/suffix halves
   * (if any) remain as undeleted placeholders so future events can still
   * reference the pre-checkpoint region.
   */
  private splitPlaceholderForDelete(
    position: number,
    offsetInRecord: number,
    length: number,
  ): AugmentedCRDTItem {
    if (offsetInRecord > 0) {
      const afterPrefix = this.splitRecordAt(position, offsetInRecord);
      position = afterPrefix;
    }
    const middle = this.sequence.at(position);
    if (!middle) {
      throw new Error(
        `Placeholder split missing record at position ${position}`,
      );
    }
    if (length < middle.content.length) {
      this.splitRecordAt(position, length);
    }
    return middle;
  }

  private prepareIndexLanding(
    index: number,
    allowEnd: boolean,
  ):
    | { readonly position: number; readonly offsetInRecord: number }
    | undefined {
    try {
      return this.sequence.prepareIndexToPositionAndOffset(index, allowEnd);
    } catch {
      return undefined;
    }
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
  }

  /**
   * YATA-style integration scan (Nicolaescu et al., 2016; Yjs `Item.integrate`).
   *
   * The destination range is the slice of the sequence strictly between
   * `originLeft` and `originRight`. Walk it left-to-right and decide,
   * for each concurrent neighbour, whether the new item belongs before
   * or after it. The decision depends only on the two items' origins and
   * event IDs, never on the order in which concurrent siblings were
   * integrated, so the engine converges to the same sequence regardless
   * of which valid topological order the caller hands it.
   *
   * Two concurrent items with identical origins are ordered by
   * {@link compareEventIds}: the smaller event ID wins and is placed
   * first, matching Yjs's `id.client` tie-break.
   */
  private findIntegrationPosition(item: AugmentedCRDTItem): number {
    const leftItem = item.originLeft
      ? this.itemsById.get(item.originLeft)
      : null;
    const rightItem = item.originRight
      ? this.itemsById.get(item.originRight)
      : null;
    const leftPos = leftItem ? this.sequence.positionOf(leftItem) : -1;
    const rightPos = rightItem
      ? this.sequence.positionOf(rightItem)
      : this.sequence.length;

    let insertPos = leftPos + 1;
    let scanPos = leftPos + 1;
    const scanned = new Set<EventId>();
    let conflicting = new Set<EventId>();

    while (scanPos < rightPos) {
      const other = this.sequence.at(scanPos);
      if (!other) {
        break;
      }
      scanned.add(other.id);
      conflicting.add(other.id);

      if (other.originLeft === item.originLeft) {
        // Same left anchor: tie-break by event ID (smaller wins, goes
        // first). If `other` has a larger event ID and shares our right
        // anchor, the new item is placed immediately before it. If the
        // right anchors differ, fall through and continue scanning.
        if (compareEventIds(other.eventId, item.eventId) < 0) {
          insertPos = scanPos + 1;
          conflicting = new Set();
        } else if (other.originRight === item.originRight) {
          break;
        }
      } else if (
        other.originLeft !== null &&
        scanned.has(other.originLeft) &&
        !conflicting.has(other.originLeft)
      ) {
        // `other`'s left anchor is a record we have already accepted as
        // belonging to the left of the new item, so the new item must
        // continue past `other` too.
        insertPos = scanPos + 1;
        conflicting = new Set();
      } else if (other.originLeft === null || !scanned.has(other.originLeft)) {
        // `other`'s left anchor sits outside the conflict region (either
        // null or a record we have not passed yet), so `other` dominates
        // the remaining slice and the new item stays before it.
        break;
      }
      scanPos++;
    }

    return insertPos;
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
    return compareEventIds(left, right);
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
