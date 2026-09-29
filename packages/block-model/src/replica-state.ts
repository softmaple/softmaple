import {
  EgWalkerReplica,
  type GraphEvent,
  type PositionOperation,
} from "@softmaple/eg-walker";
import {
  createSequenceAnchorProjection,
  type AnchorAffinity,
  type SequenceAnchor,
} from "@softmaple/eg-walker/anchors";

import { CausalIndex } from "./causal-index";
import {
  BLOCK_MODEL_SCHEMA_VERSION,
  BOOTSTRAP_BLOCK_ID,
  METADATA_MARKER,
  TEXT_ESCAPE,
} from "./constants";
import { normalizeOutputAttributes, sameMarkValue } from "./materialize";
import { RawLayer, type Segment } from "./raw-layer";
import {
  boundaryAtOrAfter,
  boundaryAtOrBefore,
  contentOffsetOf,
  isLogicalBoundary,
  logicalAt,
  splitsUnit,
  unitRanges,
  type SegmentLayout,
} from "./segment-layout";
import type { MirrorInsertEvent } from "./sequence-mirror";
import type {
  Block,
  BlockAnchor,
  BlockAttributes,
  BlockDocument,
  BlockFieldPatch,
  BlockId,
  BlockType,
  CompleteBlockFields,
  LinkAttributes,
  MarkKind,
  MarkSpan,
  ResolvedBlockAnchor,
  RichTextEffect,
  RichTextEvent,
  RichTextEventBatch,
} from "./types";
import {
  BOOTSTRAP_BATCH,
  compareIds,
  DEFAULT_BLOCK_FIELDS,
  fromGraphEvent,
  toGraphEvent,
} from "./wire";

const MARK_KINDS = [
  "bold",
  "italic",
  "underline",
  "strike",
  "inline-code",
  "link",
] as const;

const FIELD_NAMES = [
  "type",
  "parentId",
  "language",
  "theme",
  "start",
  "value",
  "checked",
] as const;

const METADATA_CODE = METADATA_MARKER.charCodeAt(0);
const ESCAPE_CODE = TEXT_ESCAPE.charCodeAt(0);

/**
 * Remote deliveries up to this many events are handed to EG-walker one event
 * at a time. That keeps its warm replay engine and reports an exact position
 * operation for each concurrent event; larger deliveries are applied as one
 * batch and fall back to a projection rebuild when they are not linear.
 */
const PER_EVENT_INTEGRATION_LIMIT = 64;

type FieldName = (typeof FIELD_NAMES)[number];
type FieldValue = CompleteBlockFields[FieldName];

interface FieldCandidate {
  readonly eventId: string;
  readonly value: FieldValue;
}

interface BlockMeta {
  readonly id: BlockId;
  markerEventId: string | null;
  sourceBlockId: BlockId | null;
  /** Causally maximal assignments per field. */
  readonly fields: Map<FieldName, FieldCandidate[]>;
  resolved: CompleteBlockFields | null;
  /** Remove-wins causes, including those inherited through splits. */
  readonly causes: Set<string>;
  readonly joins: string[];
}

interface MarkRecord {
  readonly eventId: string;
  readonly blockId: BlockId;
  readonly kind: MarkKind;
  readonly value: true | LinkAttributes | null;
  readonly start: SequenceAnchor;
  readonly end: SequenceAnchor;
}

interface ResolvedMark {
  readonly mark: MarkRecord;
  readonly start: number;
  readonly end: number;
}

/** A visible block: a head segment followed by the segments joined into it. */
export interface VisibleBlock {
  readonly id: BlockId;
  readonly index: number;
  readonly segments: ReadonlyArray<Segment>;
  readonly block: Block;
}

interface VisibleRecord extends VisibleBlock {
  block: Block;
}

interface PlacedBoundary {
  readonly raw: number;
  readonly blockId: BlockId;
  readonly offset: number;
}

/** A tombstone needed for an answer has an unknown position. */
class StaleRawLayer extends Error {
  constructor() {
    super("Raw sequence mirror needs a projection rebuild");
  }
}

/**
 * Long-lived EG-walker replica plus the incremental block projection derived
 * from it.
 *
 * Each integrated event updates the causal index, the raw layer and the block
 * metadata it touches. Reading the document rebuilds only the visible blocks
 * whose segments changed; a block-level structural change (create, delete,
 * join, field change) regroups segments in one pass over the block list.
 * The result is identical to `materializeBlockState` over the same events.
 */
export class ReplicaState {
  private readonly egWalker: EgWalkerReplica;
  private readonly causal = new CausalIndex();
  private raw = RawLayer.empty();
  private rawExact = true;
  private readonly insertEvents: MirrorInsertEvent[] = [];
  private readonly blocks = new Map<BlockId, BlockMeta>();
  private readonly children = new Map<BlockId, BlockId[]>();
  private readonly joinEventIds: string[] = [];
  private readonly marksByOwner = new Map<BlockId, MarkRecord[]>();
  private unindexedMarks: MarkRecord[] = [];
  private structureDirty = true;
  private everythingDirty = true;
  private visible: VisibleRecord[] = [];
  private visibleById = new Map<BlockId, VisibleRecord>();
  private visibleBySegment = new Map<Segment, VisibleRecord>();
  private documentCache: BlockDocument | null = null;

  constructor(replicaId: string) {
    this.egWalker = new EgWalkerReplica(replicaId);
    this.integrateBatches([BOOTSTRAP_BATCH]);
  }

  /** Integrate ready batches in causal order. */
  integrateBatches(batches: ReadonlyArray<RichTextEventBatch>): void {
    const events = batches.flatMap((batch) => batch.events);
    if (events.length <= PER_EVENT_INTEGRATION_LIMIT) {
      for (const event of events) {
        this.integrateRemote([event]);
      }
    } else {
      this.integrateRemote(events);
    }
    this.settle();
  }

  /** Apply a local insert and integrate its rich-text event. */
  insert(
    rawIndex: number,
    text: string,
    effectFor: (event: GraphEvent) => RichTextEffect,
    rejection: string,
  ): RichTextEvent {
    const graphEvent = this.egWalker.insert(rawIndex, text);
    if (graphEvent === null) {
      throw new Error(rejection);
    }
    const event = fromGraphEvent(graphEvent, effectFor(graphEvent));
    this.integrateEvent(
      event,
      { type: "insert", index: rawIndex, length: text.length },
      true,
    );
    this.settle();
    return event;
  }

  /** Apply a local delete and integrate its rich-text event. */
  delete(
    rawIndex: number,
    length: number,
    effect: RichTextEffect,
    rejection: string,
  ): RichTextEvent {
    const graphEvent = this.egWalker.delete(rawIndex, length);
    if (graphEvent === null) {
      throw new Error(rejection);
    }
    const event = fromGraphEvent(graphEvent, effect);
    this.integrateEvent(
      event,
      { type: "delete", index: rawIndex, length },
      true,
    );
    this.settle();
    return event;
  }

  hasEvent(eventId: string): boolean {
    return this.causal.has(eventId);
  }

  hasBlockMarker(blockId: BlockId): boolean {
    return (this.blocks.get(blockId)?.markerEventId ?? null) !== null;
  }

  frontier(): ReadonlyArray<string> {
    return [...this.egWalker.getFrontier()].sort(compareIds);
  }

  rawLength(): number {
    this.settle();
    return this.raw.length;
  }

  document(): BlockDocument {
    this.refresh();
    if (this.documentCache === null) {
      this.documentCache = Object.freeze({
        schemaVersion: BLOCK_MODEL_SCHEMA_VERSION,
        blocks: Object.freeze(this.visible.map(({ block }) => block)),
      });
    }
    return this.documentCache;
  }

  visibleBlock(blockId: BlockId): VisibleBlock | undefined {
    this.refresh();
    return this.visibleById.get(blockId);
  }

  firstVisibleBlock(): VisibleBlock | undefined {
    this.refresh();
    return this.visible[0];
  }

  requireVisibleBlock(blockId: BlockId): VisibleBlock {
    const block = this.visibleBlock(blockId);
    if (block === undefined) {
      throw new Error(`Unknown or hidden block ${blockId}`);
    }
    return block;
  }

  /** Raw index of a logical block offset, rejecting split code points. */
  rawBoundary(block: VisibleBlock, offset: number): number {
    if (!Number.isSafeInteger(offset) || offset < 0) {
      throw new Error("Block offset must be a non-negative safe integer");
    }
    let base = 0;
    for (const segment of block.segments) {
      const { layout } = segment;
      if (offset <= base + layout.text.length) {
        const local = offset - base;
        if (!isLogicalBoundary(layout, local)) {
          break;
        }
        return this.raw.contentStart(segment) + contentOffsetOf(layout, local);
      }
      base += layout.text.length;
    }
    throw new Error(
      `Block offset ${offset} is out of range or splits a surrogate pair`,
    );
  }

  /** Raw end of a visible block, before the next marker. */
  rawEnd(block: VisibleBlock): number {
    const last = block.segments.at(-1)!;
    return this.raw.contentStart(last) + last.layout.content.length;
  }

  /**
   * Raw ranges holding the text units of logical `[from, to)`, split wherever
   * a metadata marker or joined block marker interrupts them.
   */
  deleteRanges(
    block: VisibleBlock,
    from: number,
    to: number,
  ): Array<{ readonly start: number; readonly end: number }> {
    const ranges: Array<{ readonly start: number; readonly end: number }> = [];
    let base = 0;
    for (const segment of block.segments) {
      const length = segment.layout.text.length;
      const localFrom = Math.max(from, base) - base;
      const localTo = Math.min(to, base + length) - base;
      if (localFrom < localTo) {
        const origin = this.raw.contentStart(segment);
        for (const range of unitRanges(segment.layout, localFrom, localTo)) {
          ranges.push({ start: origin + range.start, end: origin + range.end });
        }
      }
      base += length;
    }
    return ranges;
  }

  captureAnchor(rawIndex: number, affinity: AnchorAffinity): SequenceAnchor {
    this.settle();
    return this.raw.captureAnchor(rawIndex, affinity);
  }

  captureBlockAnchor(
    blockId: BlockId,
    offset: number,
    affinity: AnchorAffinity,
  ): BlockAnchor {
    const block = this.requireVisibleBlock(blockId);
    const rawIndex = this.rawBoundary(block, offset);
    return Object.freeze({
      blockId,
      anchor: this.raw.captureAnchor(rawIndex, affinity),
    });
  }

  resolveBlockAnchor(anchor: BlockAnchor): ResolvedBlockAnchor {
    return this.withExactRaw(() => {
      this.refresh();
      const resolved = this.nearestBoundary(
        this.resolveIndex(anchor.anchor),
        anchor,
      );
      if (resolved === null) {
        throw new Error("Cannot resolve block anchor in an empty document");
      }
      return resolved;
    });
  }

  tryResolveBlockAnchor(anchor: BlockAnchor): ResolvedBlockAnchor | null {
    return this.withExactRaw(() => {
      this.refresh();
      const lookup = this.raw.lookupAnchor(anchor.anchor, (eventId) =>
        this.causal.has(eventId),
      );
      if (lookup.kind === "unknown") {
        return null;
      }
      if (lookup.kind === "uncertain") {
        throw new StaleRawLayer();
      }
      const resolved = this.nearestBoundary(lookup.index, anchor);
      if (resolved === null) {
        throw new Error("Cannot resolve block anchor in an empty document");
      }
      return resolved;
    });
  }

  private integrateRemote(events: ReadonlyArray<RichTextEvent>): void {
    const result = this.egWalker.applyRemoteEvents(events.map(toGraphEvent));
    const exact = result.operations !== null;
    events.forEach((event, index) => {
      const outcome = result.results[index];
      if (outcome?.status !== "integrated") {
        throw new Error(`EG-walker did not integrate event ${event.id}`);
      }
      this.integrateEvent(event, exact ? outcome.operation : null, exact);
    });
  }

  private integrateEvent(
    event: RichTextEvent,
    operation: PositionOperation | null,
    exact: boolean,
  ): void {
    const sequential = this.causal.extendsFrontier(event.parentVersion);
    this.causal.add(event.id, event.parentVersion);
    const { effect, operation: source } = event;
    if (source.type === "insert") {
      this.insertEvents.push({ id: event.id, text: source.text });
    }
    if (this.rawExact) {
      if (!exact || (operation === null && source.type === "insert")) {
        this.rawExact = false;
      } else if (operation?.type === "insert") {
        if (
          source.type !== "insert" ||
          operation.length !== source.text.length
        ) {
          throw new Error(`EG-walker reported a mismatched insert ${event.id}`);
        }
        this.raw.insert(
          operation.index,
          event.id,
          source.text,
          sequential,
          effect.type === "bootstrap" || effect.type === "block-create"
            ? effect.blockId
            : null,
        );
      } else if (operation?.type === "delete") {
        this.raw.delete(operation.index, operation.length);
      }
    }
    this.applyEffect(event.id, effect);
  }

  private applyEffect(eventId: string, effect: RichTextEffect): void {
    switch (effect.type) {
      case "bootstrap":
        this.createBlock(eventId, effect.blockId, null, effect.fields);
        return;
      case "block-create":
        this.createBlock(
          eventId,
          effect.blockId,
          effect.sourceBlockId,
          effect.fields,
        );
        return;
      case "block-set":
        this.assignFields(this.meta(effect.blockId), eventId, effect.fields);
        this.structureDirty = true;
        return;
      case "block-delete":
        if (effect.blockId === BOOTSTRAP_BLOCK_ID) {
          throw new Error(
            "The deterministic bootstrap block cannot be deleted",
          );
        }
        this.addCause(this.meta(effect.blockId), eventId);
        return;
      case "block-join":
        if (effect.blockId === BOOTSTRAP_BLOCK_ID) {
          throw new Error("The deterministic bootstrap block cannot be joined");
        }
        this.meta(effect.blockId).joins.push(eventId);
        this.joinEventIds.push(eventId);
        this.structureDirty = true;
        return;
      case "mark-set":
        this.unindexedMarks.push({
          eventId,
          blockId: effect.blockId,
          kind: effect.kind,
          value: effect.value,
          start: effect.range.start,
          end: effect.range.end,
        });
        return;
      case "text-insert":
      case "text-delete":
        return;
    }
  }

  private meta(blockId: BlockId): BlockMeta {
    let meta = this.blocks.get(blockId);
    if (meta === undefined) {
      meta = {
        id: blockId,
        markerEventId: null,
        sourceBlockId: null,
        fields: new Map(),
        resolved: null,
        causes: new Set(),
        joins: [],
      };
      this.blocks.set(blockId, meta);
    }
    return meta;
  }

  private createBlock(
    eventId: string,
    blockId: BlockId,
    sourceBlockId: BlockId | null,
    fields: CompleteBlockFields,
  ): void {
    const meta = this.meta(blockId);
    if (meta.markerEventId !== null) {
      throw new Error(`Duplicate block ID ${blockId}`);
    }
    meta.markerEventId = eventId;
    meta.sourceBlockId = sourceBlockId;
    this.assignFields(meta, eventId, fields);
    if (sourceBlockId !== null) {
      const siblings = this.children.get(sourceBlockId);
      if (siblings === undefined) {
        this.children.set(sourceBlockId, [blockId]);
      } else {
        siblings.push(blockId);
      }
      this.assertAcyclicLineage(blockId);
      for (const cause of [...(this.blocks.get(sourceBlockId)?.causes ?? [])]) {
        if (!this.causal.isAncestor(eventId, cause)) {
          this.addCause(meta, cause);
        }
      }
    }
    if (this.children.has(blockId)) {
      // Blocks split from this ID before it existed now inherit its lineage.
      this.everythingDirty = true;
    }
    this.structureDirty = true;
  }

  private assertAcyclicLineage(blockId: BlockId): void {
    const seen = new Set<BlockId>();
    for (let current: BlockId | null = blockId; current !== null; ) {
      if (seen.has(current)) {
        throw new Error(`Cyclic split lineage at block ${current}`);
      }
      seen.add(current);
      current = this.sourceOf(current);
    }
  }

  private sourceOf(blockId: BlockId): BlockId | null {
    const meta = this.blocks.get(blockId);
    return meta === undefined || meta.markerEventId === null
      ? null
      : meta.sourceBlockId;
  }

  /**
   * A remove that did not observe a split also removes the split child; one
   * that causally follows the split targeted only its source.
   */
  private addCause(target: BlockMeta, cause: string): void {
    const stack = [target];
    while (stack.length > 0) {
      const meta = stack.pop()!;
      if (meta.causes.has(cause)) {
        continue;
      }
      meta.causes.add(cause);
      for (const childId of this.children.get(meta.id) ?? []) {
        const child = this.blocks.get(childId)!;
        if (!this.causal.isAncestor(child.markerEventId!, cause)) {
          stack.push(child);
        }
      }
    }
    this.structureDirty = true;
  }

  private assignFields(
    meta: BlockMeta,
    eventId: string,
    fields: BlockFieldPatch,
  ): void {
    for (const field of FIELD_NAMES) {
      const value = fields[field];
      if (value === undefined) {
        continue;
      }
      const candidates = (meta.fields.get(field) ?? []).filter(
        (candidate) => !this.causal.isAncestor(candidate.eventId, eventId),
      );
      candidates.push({ eventId, value });
      meta.fields.set(field, candidates);
    }
    meta.resolved = null;
  }

  private resolveFields(meta: BlockMeta): CompleteBlockFields {
    if (meta.resolved !== null) {
      return meta.resolved;
    }
    const winner = (field: FieldName): FieldValue => {
      const candidates = meta.fields.get(field);
      if (candidates === undefined || candidates.length === 0) {
        return DEFAULT_BLOCK_FIELDS[field];
      }
      return candidates.reduce((best, candidate) =>
        compareIds(best.eventId, candidate.eventId) < 0 ? candidate : best,
      ).value;
    };
    meta.resolved = {
      type: winner("type") as BlockType,
      parentId: winner("parentId") as string | null,
      language: winner("language") as string | null,
      theme: winner("theme") as string | null,
      start: winner("start") as number | null,
      value: winner("value") as number | null,
      checked: winner("checked") as boolean | null,
    };
    return meta.resolved;
  }

  /** Make the raw layer exact again and index marks integrated since. */
  private settle(): void {
    this.withExactRaw(() => {
      if (!this.rawExact) {
        this.rebuildRaw();
      }
      this.indexMarks();
    });
  }

  private withExactRaw<T>(work: () => T): T {
    try {
      return work();
    } catch (error) {
      if (!(error instanceof StaleRawLayer)) {
        throw error;
      }
      this.rebuildRaw();
      return work();
    }
  }

  private rebuildRaw(): void {
    const markers = [...this.blocks.values()].flatMap((meta) =>
      meta.markerEventId === null
        ? []
        : [{ blockId: meta.id, eventId: meta.markerEventId }],
    );
    this.raw = RawLayer.fromProjection(
      createSequenceAnchorProjection(this.egWalker),
      this.insertEvents,
      markers,
    );
    this.rawExact = true;
    this.structureDirty = true;
    this.everythingDirty = true;
  }

  private indexMarks(): void {
    while (this.unindexedMarks.length > 0) {
      const mark = this.unindexedMarks[0]!;
      const start = this.resolveIndex(mark.start);
      const end = this.resolveIndex(mark.end);
      for (const owner of this.markOwners(mark)) {
        const owned = this.marksByOwner.get(owner);
        if (owned === undefined) {
          this.marksByOwner.set(owner, [mark]);
        } else {
          owned.push(mark);
        }
      }
      if (start < end) {
        this.markRangeDirty(start, end);
      }
      this.unindexedMarks.shift();
    }
  }

  private resolveIndex(anchor: SequenceAnchor): number {
    const lookup = this.raw.lookupAnchor(anchor, (eventId) =>
      this.causal.has(eventId),
    );
    if (lookup.kind === "resolved") {
      return lookup.index;
    }
    if (lookup.kind === "uncertain") {
      throw new StaleRawLayer();
    }
    return RawLayer.unknownAnchor(anchor);
  }

  /**
   * Recover the visible block group that owned a mark when it was set.
   * Ownership depends only on the mark's causal past, so it never changes
   * after integration.
   */
  private markOwners(mark: MarkRecord): ReadonlySet<BlockId> {
    if (
      !this.joinEventIds.some((joinId) =>
        this.causal.isAncestor(joinId, mark.eventId),
      )
    ) {
      return new Set([mark.blockId]);
    }
    const observed = this.causal.collectAncestors(mark.eventId);
    let visibleOwner: BlockId | null = null;
    const owned = new Set<BlockId>();
    for (const segment of this.raw.segmentList) {
      const meta = this.blocks.get(segment.blockId)!;
      if (
        !observed.has(meta.markerEventId!) ||
        [...meta.causes].some((cause) => observed.has(cause))
      ) {
        continue;
      }
      const joinedBeforeMark = meta.joins.some((joinId) =>
        observed.has(joinId),
      );
      if (!joinedBeforeMark || visibleOwner === null) {
        visibleOwner = meta.id;
      }
      if (visibleOwner === mark.blockId) {
        owned.add(meta.id);
      }
    }
    if (owned.size === 0) {
      owned.add(mark.blockId);
    }
    return owned;
  }

  private markRangeDirty(start: number, end: number): void {
    const segments = this.raw.segmentList;
    const first = this.raw.segmentAtAtom(start);
    for (let index = first?.index ?? 0; index < segments.length; index++) {
      const segment = segments[index]!;
      if (this.raw.contentStart(segment) - 1 >= end) {
        break;
      }
      this.raw.dirty.add(segment);
    }
  }

  private refresh(): void {
    this.settle();
    this.withExactRaw(() => this.refreshBlocks());
  }

  private refreshBlocks(): void {
    const dirty = this.raw.dirty;
    if (!this.structureDirty && !this.everythingDirty) {
      if (dirty.size === 0) {
        return;
      }
      const touched = new Set<VisibleRecord>();
      for (const segment of dirty) {
        const record = this.visibleBySegment.get(segment);
        if (record !== undefined) {
          touched.add(record);
        }
      }
      const rebuilt = [...touched].map(
        (record) =>
          [
            record,
            this.materialize(
              record.id,
              record.segments,
              record.block.type,
              record.block.attrs,
            ),
          ] as const,
      );
      for (const [record, block] of rebuilt) {
        record.block = block;
      }
      dirty.clear();
      if (rebuilt.length > 0) {
        this.documentCache = null;
      }
      return;
    }

    const groups: Array<{
      readonly id: BlockId;
      readonly segments: Segment[];
    }> = [];
    for (const segment of this.raw.segmentList) {
      const meta = this.blocks.get(segment.blockId)!;
      if (meta.causes.size > 0) {
        continue;
      }
      if (meta.joins.length > 0) {
        groups.at(-1)?.segments.push(segment);
        continue;
      }
      groups.push({ id: meta.id, segments: [segment] });
    }
    const types = new Map<BlockId, BlockType>();
    const records: VisibleRecord[] = [];
    const byId = new Map<BlockId, VisibleRecord>();
    const bySegment = new Map<Segment, VisibleRecord>();
    for (const group of groups) {
      const fields = this.resolveFields(this.blocks.get(group.id)!);
      const attrs = normalizeOutputAttributes(
        fields.type,
        requestedAttributes(fields),
        types,
      );
      types.set(group.id, fields.type);
      const previous = this.visibleById.get(group.id);
      const block =
        previous !== undefined &&
        !this.everythingDirty &&
        previous.block.type === fields.type &&
        sameAttributes(previous.block.attrs, attrs) &&
        sameSegments(previous.segments, group.segments) &&
        group.segments.every((segment) => !dirty.has(segment))
          ? previous.block
          : this.materialize(
              group.id,
              group.segments,
              fields.type,
              Object.freeze(attrs),
            );
      const record: VisibleRecord = {
        id: group.id,
        index: records.length,
        segments: group.segments,
        block,
      };
      records.push(record);
      byId.set(record.id, record);
      for (const segment of record.segments) {
        bySegment.set(segment, record);
      }
    }
    this.visible = records;
    this.visibleById = byId;
    this.visibleBySegment = bySegment;
    dirty.clear();
    this.structureDirty = false;
    this.everythingDirty = false;
    this.documentCache = null;
  }

  private materialize(
    id: BlockId,
    segments: ReadonlyArray<Segment>,
    type: BlockType,
    attrs: BlockAttributes,
  ): Block {
    const text =
      segments.length === 1
        ? segments[0]!.layout.text
        : segments.map(({ layout }) => layout.text).join("");
    return Object.freeze({
      id,
      type,
      text,
      attrs,
      marks: Object.freeze(this.computeMarks(segments)),
    });
  }

  private computeMarks(segments: ReadonlyArray<Segment>): MarkSpan[] {
    let base = 0;
    const parts = segments.map((segment) => {
      const part = {
        segment,
        base,
        marks: this.relevantMarks(segment.blockId),
      };
      base += segment.layout.text.length;
      return part;
    });
    if (parts.every(({ marks }) => marks.length === 0)) {
      return [];
    }
    const resolved = new Map<MarkRecord, ResolvedMark | null>();
    const resolve = (mark: MarkRecord): ResolvedMark | null => {
      let entry = resolved.get(mark);
      if (entry === undefined) {
        const start = this.resolveIndex(mark.start);
        const end = this.resolveIndex(mark.end);
        entry = start < end ? { mark, start, end } : null;
        resolved.set(mark, entry);
      }
      return entry;
    };
    const spans: MarkSpan[] = [];
    for (const kind of MARK_KINDS) {
      for (const part of parts) {
        const events: ResolvedMark[] = [];
        for (const mark of part.marks) {
          if (mark.kind !== kind) {
            continue;
          }
          const entry = resolve(mark);
          if (entry !== null) {
            events.push(entry);
          }
        }
        if (events.length > 0) {
          this.appendSegmentSpans(spans, kind, part.segment, part.base, events);
        }
      }
    }
    return spans.sort(
      (left, right) =>
        left.from - right.from ||
        left.to - right.to ||
        compareIds(left.kind, right.kind),
    );
  }

  /** Marks owned by any block in this block's split lineage. */
  private relevantMarks(blockId: BlockId): ReadonlyArray<MarkRecord> {
    let result: MarkRecord[] | null = null;
    let seen: Set<MarkRecord> | null = null;
    for (
      let current: BlockId | null = blockId;
      current !== null;
      current = this.sourceOf(current)
    ) {
      const owned = this.marksByOwner.get(current);
      if (owned === undefined) {
        continue;
      }
      if (result === null) {
        result = [...owned];
        continue;
      }
      seen ??= new Set(result);
      for (const mark of owned) {
        if (!seen.has(mark)) {
          seen.add(mark);
          result.push(mark);
        }
      }
    }
    return result ?? [];
  }

  /**
   * Units between two consecutive mark endpoints share one candidate set, so
   * each such run needs one causal-LWW decision instead of one per unit.
   */
  private appendSegmentSpans(
    spans: MarkSpan[],
    kind: MarkKind,
    segment: Segment,
    base: number,
    events: ReadonlyArray<ResolvedMark>,
  ): void {
    const { layout } = segment;
    const origin = this.raw.contentStart(segment);
    const length = layout.content.length;
    const cuts = new Set([0, length]);
    for (const event of events) {
      for (const point of [event.start - origin, event.end - origin]) {
        if (point > 0 && point < length) {
          cuts.add(point);
        }
      }
    }
    const points = [...cuts].sort((left, right) => left - right);
    if (points.some((point) => splitsUnit(layout, point))) {
      this.appendUnitSpans(spans, kind, layout, origin, base, events);
      return;
    }
    for (let index = 0; index + 1 < points.length; index++) {
      const rawFrom = origin + points[index]!;
      const rawTo = origin + points[index + 1]!;
      const from = logicalAt(layout, points[index]!);
      const to = logicalAt(layout, points[index + 1]!);
      if (from < to) {
        this.appendSpan(
          spans,
          kind,
          base + from,
          base + to,
          events.filter(({ start, end }) => start <= rawFrom && rawTo <= end),
        );
      }
    }
  }

  /** Per-unit evaluation for endpoints that fall inside a unit. */
  private appendUnitSpans(
    spans: MarkSpan[],
    kind: MarkKind,
    layout: SegmentLayout,
    origin: number,
    base: number,
    events: ReadonlyArray<ResolvedMark>,
  ): void {
    const { content } = layout;
    let raw = 0;
    let logical = 0;
    while (raw < content.length) {
      const code = content.charCodeAt(raw);
      if (code === METADATA_CODE) {
        raw++;
        continue;
      }
      const next = content.charCodeAt(raw + 1);
      const width =
        code === ESCAPE_CODE ||
        (code >= 0xd800 && code <= 0xdbff && next >= 0xdc00 && next <= 0xdfff)
          ? 2
          : 1;
      const logicalWidth = code === ESCAPE_CODE ? 1 : width;
      const rawFrom = origin + raw;
      const rawTo = rawFrom + width;
      this.appendSpan(
        spans,
        kind,
        base + logical,
        base + logical + logicalWidth,
        events.filter(({ start, end }) => start <= rawFrom && rawTo <= end),
      );
      raw += width;
      logical += logicalWidth;
    }
  }

  private appendSpan(
    spans: MarkSpan[],
    kind: MarkKind,
    from: number,
    to: number,
    candidates: ReadonlyArray<ResolvedMark>,
  ): void {
    if (candidates.length === 0) {
      return;
    }
    const value = this.selectWinner(candidates).mark.value;
    if (value === null) {
      return;
    }
    const previous = spans.at(-1);
    if (
      previous?.kind === kind &&
      previous.to === from &&
      sameMarkValue(previous.value, value)
    ) {
      spans[spans.length - 1] = { ...previous, to };
    } else {
      spans.push({ kind, from, to, value });
    }
  }

  /** Causal LWW: the largest event ID among the causally maximal marks. */
  private selectWinner(candidates: ReadonlyArray<ResolvedMark>): ResolvedMark {
    let winner: ResolvedMark | null = null;
    for (const candidate of candidates) {
      const dominated = candidates.some(
        (other) =>
          other.mark.eventId !== candidate.mark.eventId &&
          this.causal.isAncestor(candidate.mark.eventId, other.mark.eventId),
      );
      if (
        !dominated &&
        (winner === null ||
          compareIds(winner.mark.eventId, candidate.mark.eventId) < 0)
      ) {
        winner = candidate;
      }
    }
    if (winner === null) {
      throw new Error("Cannot resolve a causal LWW winner");
    }
    return winner;
  }

  /** Nearest visible block boundary, matching the full projection's rules. */
  private nearestBoundary(
    rawIndex: number,
    anchor: BlockAnchor,
  ): ResolvedBlockAnchor | null {
    const before = this.boundaryAtOrBefore(rawIndex);
    const after = this.boundaryAtOrAfter(rawIndex);
    let best: PlacedBoundary | null;
    if (before === null || after === null) {
      best = before ?? after;
    } else {
      const beforeDistance = rawIndex - before.raw;
      const afterDistance = after.raw - rawIndex;
      best =
        beforeDistance < afterDistance
          ? before
          : afterDistance < beforeDistance
            ? after
            : anchor.anchor.affinity === "after"
              ? before
              : after;
    }
    return best === null
      ? null
      : Object.freeze({ blockId: best.blockId, offset: best.offset });
  }

  private boundaryAtOrBefore(rawIndex: number): PlacedBoundary | null {
    if (rawIndex - 1 < this.raw.prefixLength) {
      return null;
    }
    let segment: Segment | undefined = this.raw.segmentAtAtom(rawIndex - 1)!;
    let offset = rawIndex - this.raw.contentStart(segment);
    while (segment !== undefined) {
      const record = this.visibleBySegment.get(segment);
      if (record !== undefined) {
        return this.place(
          record,
          segment,
          boundaryAtOrBefore(segment.layout, offset),
        );
      }
      segment = this.raw.segmentList[segment.index - 1];
      offset = segment?.layout.content.length ?? 0;
    }
    return null;
  }

  private boundaryAtOrAfter(rawIndex: number): PlacedBoundary | null {
    let segment: Segment | undefined;
    let offset = 0;
    if (rawIndex - 1 < this.raw.prefixLength) {
      segment = this.raw.segmentList[0];
    } else {
      segment = this.raw.segmentAtAtom(rawIndex - 1)!;
      offset = rawIndex - this.raw.contentStart(segment);
    }
    while (segment !== undefined) {
      const record = this.visibleBySegment.get(segment);
      if (record !== undefined) {
        const boundary = boundaryAtOrAfter(segment.layout, offset);
        if (boundary !== null) {
          return this.place(record, segment, boundary);
        }
      }
      segment = this.raw.segmentList[segment.index + 1];
      offset = 0;
    }
    return null;
  }

  private place(
    record: VisibleRecord,
    segment: Segment,
    boundary: { readonly logical: number; readonly offset: number },
  ): PlacedBoundary {
    let base = 0;
    for (const member of record.segments) {
      if (member === segment) {
        break;
      }
      base += member.layout.text.length;
    }
    return {
      raw: this.raw.contentStart(segment) + boundary.offset,
      blockId: record.id,
      offset: base + boundary.logical,
    };
  }
}

const requestedAttributes = (fields: CompleteBlockFields): BlockAttributes => ({
  parentId: fields.parentId,
  language: fields.language,
  theme: fields.theme,
  start: fields.start,
  value: fields.value,
  checked: fields.checked,
});

const sameAttributes = (left: BlockAttributes, right: BlockAttributes) =>
  left.parentId === right.parentId &&
  left.language === right.language &&
  left.theme === right.theme &&
  left.start === right.start &&
  left.value === right.value &&
  left.checked === right.checked;

const sameSegments = (
  left: ReadonlyArray<Segment>,
  right: ReadonlyArray<Segment>,
): boolean =>
  left.length === right.length &&
  left.every((segment, index) => segment === right[index]);
