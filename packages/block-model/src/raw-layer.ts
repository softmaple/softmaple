import {
  InvalidSequenceAtomError,
  isSequenceAnchor,
  UnknownSequenceAtomError,
  type AnchorAffinity,
  type SequenceAnchor,
  type SequenceAnchorProjection,
} from "@softmaple/eg-walker/anchors";

import { BLOCK_MARKER, BOOTSTRAP_BLOCK_ID } from "./constants";
import {
  decodeLayout,
  EMPTY_LAYOUT,
  spliceLayout,
  type SegmentLayout,
} from "./segment-layout";
import { SequenceMirror, type MirrorInsertEvent } from "./sequence-mirror";
import type { BlockId } from "./types";

/** Raw sequence content owned by one block marker, up to the next marker. */
export class Segment {
  index = 0;

  constructor(
    readonly blockId: BlockId,
    readonly markerEventId: string,
    public layout: SegmentLayout,
  ) {}
}

export interface MarkerRecord {
  readonly blockId: BlockId;
  readonly eventId: string;
}

export type AnchorLookup =
  | { readonly kind: "resolved"; readonly index: number }
  | { readonly kind: "unknown" }
  | { readonly kind: "uncertain" };

/**
 * The raw EG-walker sequence split at block markers.
 *
 * Every integrated operation is applied to both the identity mirror and the
 * segment that contains it, so a keystroke touches one segment and a Fenwick
 * tree of segment lengths instead of the whole document.
 */
export class RawLayer {
  /** Segments whose content changed since the owner last consumed this set. */
  readonly dirty = new Set<Segment>();
  private prefix = "";
  private segments: Segment[] = [];
  private readonly segmentsByBlock = new Map<BlockId, Segment>();
  private lengths = new Fenwick([]);

  private constructor(private readonly mirror: SequenceMirror) {}

  static empty(): RawLayer {
    return new RawLayer(new SequenceMirror());
  }

  /** Rebuild exact state from an anchor projection of the same replica. */
  static fromProjection(
    projection: SequenceAnchorProjection,
    insertEvents: Iterable<MirrorInsertEvent>,
    markers: Iterable<MarkerRecord>,
  ): RawLayer {
    const layer = new RawLayer(
      SequenceMirror.fromProjection(projection, insertEvents),
    );
    const raw = projection.text;
    const positioned = [...markers]
      .map((marker) => {
        const resolution = layer.mirror.resolve(marker.eventId, 0);
        if (
          resolution.kind !== "resolved" ||
          resolution.after === resolution.before ||
          raw[resolution.before] !== BLOCK_MARKER
        ) {
          throw new Error(
            `Block marker event ${marker.eventId} is not present`,
          );
        }
        return { ...marker, position: resolution.before };
      })
      .sort((left, right) => left.position - right.position);
    if (
      positioned.length === 0 ||
      positioned[0]!.blockId !== BOOTSTRAP_BLOCK_ID
    ) {
      throw new Error("Document is missing its deterministic bootstrap marker");
    }
    layer.prefix = raw.slice(0, positioned[0]!.position);
    layer.segments = positioned.map((marker, index) => {
      const end = positioned[index + 1]?.position ?? raw.length;
      const segment = new Segment(
        marker.blockId,
        marker.eventId,
        decodeLayout(raw.slice(marker.position + 1, end)),
      );
      segment.index = index;
      layer.segmentsByBlock.set(marker.blockId, segment);
      layer.dirty.add(segment);
      return segment;
    });
    layer.reindex(0);
    return layer;
  }

  get length(): number {
    return this.mirror.length;
  }

  get prefixLength(): number {
    return this.prefix.length;
  }

  get segmentList(): ReadonlyArray<Segment> {
    return this.segments;
  }

  /** Raw index of the first content code unit after the segment's marker. */
  contentStart(segment: Segment): number {
    return this.prefix.length + this.lengths.prefix(segment.index) + 1;
  }

  /** Segment whose marker or content holds raw atom `index`, or null. */
  segmentAtAtom(index: number): Segment | null {
    if (index < this.prefix.length) {
      return null;
    }
    const segment =
      this.segments[this.lengths.search(index - this.prefix.length)];
    if (segment === undefined) {
      throw new Error(`Raw index ${index} is outside the block sequence`);
    }
    return segment;
  }

  /**
   * Insert one event's text at raw `index`. A marker event opens a new
   * segment holding whatever followed the insertion point.
   */
  insert(
    index: number,
    eventId: string,
    text: string,
    sequential: boolean,
    markerBlockId: BlockId | null,
  ): void {
    const owner = index === 0 ? null : this.segmentAtAtom(index - 1);
    if (markerBlockId !== null) {
      if (owner === null && this.segments.length > 0) {
        throw new Error(
          "Document is missing its deterministic bootstrap marker",
        );
      }
      this.mirror.insert(index, eventId, text, sequential);
      this.openSegment(owner, index, markerBlockId, eventId);
      return;
    }
    this.mirror.insert(index, eventId, text, sequential);
    if (owner === null) {
      this.prefix =
        this.prefix.slice(0, index) + text + this.prefix.slice(index);
      return;
    }
    const offset = index - this.contentStart(owner);
    owner.layout = spliceLayout(owner.layout, offset, 0, text);
    this.dirty.add(owner);
    this.lengths.add(owner.index, text.length);
  }

  /** Delete `length` visible raw code units, never crossing a block marker. */
  delete(index: number, length: number): void {
    const owner = this.segmentAtAtom(index);
    if (owner === null) {
      if (index + length > this.prefix.length) {
        throw new Error(
          `Block marker event ${this.segments[0]!.markerEventId} is not present`,
        );
      }
      this.mirror.delete(index, length);
      this.prefix =
        this.prefix.slice(0, index) + this.prefix.slice(index + length);
      return;
    }
    const start = this.contentStart(owner);
    if (index < start) {
      throw new Error(
        `Block marker event ${owner.markerEventId} is not present`,
      );
    }
    if (index + length > start + owner.layout.content.length) {
      throw new Error(
        `Block marker event ${this.segments[owner.index + 1]!.markerEventId} is not present`,
      );
    }
    this.mirror.delete(index, length);
    owner.layout = spliceLayout(owner.layout, index - start, length, "");
    this.dirty.add(owner);
    this.lengths.add(owner.index, -length);
  }

  /** Capture a stable anchor exactly like an EG-walker anchor projection. */
  captureAnchor(index: number, affinity: AnchorAffinity): SequenceAnchor {
    if (affinity !== "before" && affinity !== "after") {
      throw new Error(`Invalid anchor affinity ${String(affinity)}`);
    }
    this.assertBoundary(index);
    if (affinity === "before") {
      if (index === this.length) {
        return { type: "boundary", edge: "end", affinity };
      }
      const atom = this.mirror.atomAt(index);
      return {
        type: "atom",
        eventId: atom.eventId,
        offset: atom.offset,
        affinity,
      };
    }
    if (index === 0) {
      return { type: "boundary", edge: "start", affinity };
    }
    const atom = this.mirror.atomAt(index - 1);
    return {
      type: "atom",
      eventId: atom.eventId,
      offset: atom.offset,
      affinity,
    };
  }

  /**
   * Resolve an anchor to a raw index. `known` reports whether an event is
   * integrated so a known non-insert event is invalid rather than pending.
   */
  lookupAnchor(
    anchor: SequenceAnchor,
    known: (eventId: string) => boolean,
  ): AnchorLookup {
    if (!isSequenceAnchor(anchor)) {
      throw new Error("Invalid sequence anchor");
    }
    if (anchor.type === "boundary") {
      return {
        kind: "resolved",
        index: anchor.edge === "start" ? 0 : this.length,
      };
    }
    const resolution = this.mirror.resolve(anchor.eventId, anchor.offset);
    switch (resolution.kind) {
      case "resolved": {
        const index =
          anchor.affinity === "after" ? resolution.after : resolution.before;
        this.assertBoundary(index);
        return { kind: "resolved", index };
      }
      case "uncertain":
        return resolution;
      case "invalid":
        throw new InvalidSequenceAtomError(anchor.eventId, anchor.offset);
      case "unknown":
        if (known(anchor.eventId)) {
          throw new InvalidSequenceAtomError(anchor.eventId, anchor.offset);
        }
        return resolution;
    }
  }

  /** Throw exactly like `lookupAnchor` for an anchor whose event is absent. */
  static unknownAnchor(anchor: SequenceAnchor): never {
    if (anchor.type !== "atom") {
      throw new Error("Expected an atom sequence anchor");
    }
    throw new UnknownSequenceAtomError(anchor.eventId, anchor.offset);
  }

  private assertBoundary(index: number): void {
    if (!Number.isSafeInteger(index) || index < 0 || index > this.length) {
      throw new Error(
        `Anchor index ${index} out of bounds [0, ${this.length}]`,
      );
    }
    if (
      index > 0 &&
      index < this.length &&
      isHighSurrogate(this.mirror.codeUnitAt(index - 1)) &&
      isLowSurrogate(this.mirror.codeUnitAt(index))
    ) {
      throw new Error(`Anchor index ${index} splits a UTF-16 surrogate pair`);
    }
  }

  private openSegment(
    owner: Segment | null,
    index: number,
    blockId: BlockId,
    eventId: string,
  ): void {
    if (this.segmentsByBlock.has(blockId)) {
      throw new Error(`Duplicate block ID ${blockId}`);
    }
    let tail = "";
    if (owner === null) {
      tail = this.prefix.slice(index);
      this.prefix = this.prefix.slice(0, index);
    } else {
      const offset = index - this.contentStart(owner);
      const content = owner.layout.content;
      if (offset < content.length) {
        tail = content.slice(offset);
        owner.layout = decodeLayout(content.slice(0, offset));
        this.dirty.add(owner);
      }
    }
    const segment = new Segment(
      blockId,
      eventId,
      tail.length === 0 ? EMPTY_LAYOUT : decodeLayout(tail),
    );
    const position = owner === null ? 0 : owner.index + 1;
    this.segments.splice(position, 0, segment);
    this.segmentsByBlock.set(blockId, segment);
    this.dirty.add(segment);
    this.reindex(position);
  }

  private reindex(from: number): void {
    for (let index = from; index < this.segments.length; index++) {
      this.segments[index]!.index = index;
    }
    this.lengths = new Fenwick(
      this.segments.map((segment) => segment.layout.content.length + 1),
    );
  }
}

/** Prefix sums over positive segment lengths. */
class Fenwick {
  private readonly tree: number[];
  private readonly highestStep: number;

  constructor(values: ReadonlyArray<number>) {
    const size = values.length;
    this.tree = [0, ...values];
    for (let index = 1; index <= size; index++) {
      const parent = index + (index & -index);
      if (parent <= size) {
        this.tree[parent]! += this.tree[index]!;
      }
    }
    let step = 1;
    while (step * 2 <= size) {
      step *= 2;
    }
    this.highestStep = size === 0 ? 0 : step;
  }

  add(index: number, delta: number): void {
    for (let node = index + 1; node < this.tree.length; node += node & -node) {
      this.tree[node]! += delta;
    }
  }

  /** Sum of the first `count` values. */
  prefix(count: number): number {
    let sum = 0;
    for (let node = count; node > 0; node -= node & -node) {
      sum += this.tree[node]!;
    }
    return sum;
  }

  /** Index of the value whose running range contains `target`. */
  search(target: number): number {
    let position = 0;
    let remaining = target;
    for (let step = this.highestStep; step > 0; step >>= 1) {
      const next = position + step;
      if (next < this.tree.length && this.tree[next]! <= remaining) {
        position = next;
        remaining -= this.tree[next]!;
      }
    }
    return position;
  }
}

const isHighSurrogate = (code: number): boolean =>
  code >= 0xd800 && code <= 0xdbff;

const isLowSurrogate = (code: number): boolean =>
  code >= 0xdc00 && code <= 0xdfff;
