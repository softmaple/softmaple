import type { SequenceAnchorProjection } from "@softmaple/eg-walker/anchors";

import { compareIds } from "./wire";

/**
 * Identity-preserving mirror of the EG-walker sequence, tombstones included.
 *
 * EG-walker reports every integration as an index operation. Replaying those
 * operations here keeps the identity (insert event, offset) of every UTF-16
 * atom, so stable anchors resolve without replaying the event graph.
 *
 * Visible atoms are always exact. A sequential insert lands immediately after
 * the preceding visible atom, before any tombstones in that gap, which is
 * where EG-walker's integration puts it. A concurrent insert may land anywhere
 * among the gap's tombstones, so those tombstones are marked uncertain; asking
 * for the position of an uncertain tombstone reports it instead of guessing.
 */

/** Pieces per chunk before a chunk is split in half. */
const CHUNK_SPLIT_THRESHOLD = 256;

interface Piece {
  readonly eventId: string;
  /** The inserting event's complete text; this piece covers a slice of it. */
  readonly text: string;
  readonly start: number;
  length: number;
  visible: boolean;
  /** Tombstone whose order relative to a concurrent insert is unknown. */
  uncertain: boolean;
  chunk: Chunk;
}

interface Chunk {
  readonly pieces: Piece[];
  visible: number;
}

interface VisibleLocation {
  readonly chunkIndex: number;
  readonly pieceIndex: number;
  readonly offset: number;
}

export interface MirrorAtom {
  readonly eventId: string;
  readonly offset: number;
}

export type AtomResolution =
  | {
      readonly kind: "resolved";
      readonly before: number;
      readonly after: number;
    }
  | { readonly kind: "uncertain" }
  | { readonly kind: "unknown" }
  | { readonly kind: "invalid" };

export interface MirrorInsertEvent {
  readonly id: string;
  readonly text: string;
}

export class SequenceMirror {
  private chunks: Chunk[] = [{ pieces: [], visible: 0 }];
  private readonly piecesByEvent = new Map<string, Piece[]>();
  private visibleLength = 0;

  get length(): number {
    return this.visibleLength;
  }

  /**
   * Rebuild exact positions from an anchor projection of the same replica.
   * Tombstones sharing a gap keep an arbitrary relative order: every one of
   * them resolves to the gap's boundary, and a later sequential insert lands
   * before all of them, so that order is never observable.
   */
  static fromProjection(
    projection: SequenceAnchorProjection,
    events: Iterable<MirrorInsertEvent>,
  ): SequenceMirror {
    const atoms: Array<{
      readonly event: MirrorInsertEvent;
      readonly offset: number;
      readonly before: number;
      readonly visible: boolean;
    }> = [];
    for (const event of events) {
      for (let offset = 0; offset < event.text.length; offset++) {
        atoms.push({
          event,
          offset,
          ...resolveAtom(projection, event, offset),
        });
      }
    }
    atoms.sort(
      (left, right) =>
        left.before - right.before ||
        Number(left.visible) - Number(right.visible) ||
        compareIds(left.event.id, right.event.id) ||
        left.offset - right.offset,
    );

    const mirror = new SequenceMirror();
    const pieces: Piece[] = [];
    for (const atom of atoms) {
      if (atom.before !== mirror.visibleLength) {
        throw new Error("Sequence projection is missing visible atoms");
      }
      if (atom.visible) {
        mirror.visibleLength++;
      }
      const previous = pieces.at(-1);
      if (
        previous !== undefined &&
        previous.eventId === atom.event.id &&
        previous.visible === atom.visible &&
        previous.start + previous.length === atom.offset
      ) {
        previous.length++;
        continue;
      }
      const piece: Piece = {
        eventId: atom.event.id,
        text: atom.event.text,
        start: atom.offset,
        length: 1,
        visible: atom.visible,
        uncertain: false,
        chunk: mirror.chunks[0]!,
      };
      pieces.push(piece);
      const eventPieces = mirror.piecesByEvent.get(piece.eventId);
      if (eventPieces === undefined) {
        mirror.piecesByEvent.set(piece.eventId, [piece]);
      } else {
        eventPieces.push(piece);
      }
    }
    for (const eventPieces of mirror.piecesByEvent.values()) {
      eventPieces.sort((left, right) => left.start - right.start);
    }
    mirror.chunks = chunkPieces(pieces);
    if (mirror.visibleLength !== projection.text.length) {
      throw new Error("Sequence mirror disagrees with the projected text");
    }
    return mirror;
  }

  /**
   * Insert `text` so that its first atom lands at visible `index`.
   * `sequential` means the inserting event extends the complete current
   * version, so no concurrent atom can precede it in the gap.
   */
  insert(
    index: number,
    eventId: string,
    text: string,
    sequential: boolean,
  ): void {
    if (text.length === 0) {
      throw new Error("Cannot mirror an empty insert");
    }
    if (this.piecesByEvent.has(eventId)) {
      throw new Error(`Insert event ${eventId} is already mirrored`);
    }
    this.assertBoundary(index);
    let chunkIndex = 0;
    let pieceIndex = 0;
    if (index > 0) {
      const location = this.locate(index - 1);
      const piece = this.pieceAt(location);
      if (location.offset < piece.length - 1) {
        this.split(
          location.chunkIndex,
          location.pieceIndex,
          location.offset + 1,
        );
      }
      chunkIndex = location.chunkIndex;
      pieceIndex = location.pieceIndex + 1;
    }
    if (!sequential) {
      this.markGapUncertain(chunkIndex, pieceIndex);
    }
    const chunk = this.chunks[chunkIndex]!;
    const piece: Piece = {
      eventId,
      text,
      start: 0,
      length: text.length,
      visible: true,
      uncertain: false,
      chunk,
    };
    chunk.pieces.splice(pieceIndex, 0, piece);
    chunk.visible += text.length;
    this.visibleLength += text.length;
    this.piecesByEvent.set(eventId, [piece]);
    this.rebalance(chunkIndex);
  }

  /** Tombstone `length` visible atoms starting at visible `index`. */
  delete(index: number, length: number): void {
    if (!Number.isSafeInteger(length) || length <= 0) {
      throw new Error("Mirror delete length must be positive");
    }
    if (
      !Number.isSafeInteger(index) ||
      index < 0 ||
      index + length > this.visibleLength
    ) {
      throw new Error(
        `Mirror delete [${index}, ${index + length}) is out of range`,
      );
    }
    const first = this.locate(index);
    let chunkIndex = first.chunkIndex;
    let pieceIndex = first.pieceIndex;
    if (first.offset > 0) {
      this.split(chunkIndex, pieceIndex, first.offset);
      pieceIndex++;
    }
    const touched = new Set<number>([chunkIndex]);
    let remaining = length;
    while (remaining > 0) {
      const chunk = this.chunks[chunkIndex]!;
      if (pieceIndex >= chunk.pieces.length) {
        chunkIndex++;
        pieceIndex = 0;
        continue;
      }
      const piece = chunk.pieces[pieceIndex]!;
      if (!piece.visible) {
        pieceIndex++;
        continue;
      }
      if (piece.length > remaining) {
        this.split(chunkIndex, pieceIndex, remaining);
        touched.add(chunkIndex);
      }
      piece.visible = false;
      piece.uncertain = false;
      chunk.visible -= piece.length;
      this.visibleLength -= piece.length;
      remaining -= piece.length;
      pieceIndex++;
    }
    for (const touchedIndex of [...touched].sort((a, b) => b - a)) {
      this.rebalance(touchedIndex);
    }
  }

  /** Visible position of one atom, or why it cannot be resolved exactly. */
  resolve(eventId: string, offset: number): AtomResolution {
    const eventPieces = this.piecesByEvent.get(eventId);
    if (eventPieces === undefined) {
      return { kind: "unknown" };
    }
    const piece = findPiece(eventPieces, offset);
    if (piece === undefined) {
      return { kind: "invalid" };
    }
    if (!piece.visible && piece.uncertain) {
      return { kind: "uncertain" };
    }
    let before = 0;
    for (const chunk of this.chunks) {
      if (chunk === piece.chunk) {
        break;
      }
      before += chunk.visible;
    }
    for (const candidate of piece.chunk.pieces) {
      if (candidate === piece) {
        break;
      }
      if (candidate.visible) {
        before += candidate.length;
      }
    }
    if (!piece.visible) {
      return { kind: "resolved", before, after: before };
    }
    before += offset - piece.start;
    return { kind: "resolved", before, after: before + 1 };
  }

  /** Identity of the visible atom at `index`. */
  atomAt(index: number): MirrorAtom {
    const location = this.locate(index);
    const piece = this.pieceAt(location);
    return { eventId: piece.eventId, offset: piece.start + location.offset };
  }

  /** UTF-16 code unit of the visible atom at `index`. */
  codeUnitAt(index: number): number {
    const location = this.locate(index);
    const piece = this.pieceAt(location);
    return piece.text.charCodeAt(piece.start + location.offset);
  }

  private assertBoundary(index: number): void {
    if (
      !Number.isSafeInteger(index) ||
      index < 0 ||
      index > this.visibleLength
    ) {
      throw new Error(
        `Mirror index ${index} out of bounds [0, ${this.visibleLength}]`,
      );
    }
  }

  private locate(index: number): VisibleLocation {
    if (
      !Number.isSafeInteger(index) ||
      index < 0 ||
      index >= this.visibleLength
    ) {
      throw new Error(`Mirror atom ${index} out of bounds`);
    }
    let remaining = index;
    for (let chunkIndex = 0; chunkIndex < this.chunks.length; chunkIndex++) {
      const chunk = this.chunks[chunkIndex]!;
      if (remaining >= chunk.visible) {
        remaining -= chunk.visible;
        continue;
      }
      for (let pieceIndex = 0; pieceIndex < chunk.pieces.length; pieceIndex++) {
        const piece = chunk.pieces[pieceIndex]!;
        if (!piece.visible) {
          continue;
        }
        if (remaining < piece.length) {
          return { chunkIndex, pieceIndex, offset: remaining };
        }
        remaining -= piece.length;
      }
    }
    throw new Error("Sequence mirror visible counts are corrupt");
  }

  private pieceAt(location: VisibleLocation): Piece {
    return this.chunks[location.chunkIndex]!.pieces[location.pieceIndex]!;
  }

  /** Split a piece so that its first `length` atoms stay in place. */
  private split(chunkIndex: number, pieceIndex: number, length: number): void {
    const chunk = this.chunks[chunkIndex]!;
    const piece = chunk.pieces[pieceIndex]!;
    if (length <= 0 || length >= piece.length) {
      throw new Error("Mirror split must fall strictly inside a piece");
    }
    const right: Piece = {
      eventId: piece.eventId,
      text: piece.text,
      start: piece.start + length,
      length: piece.length - length,
      visible: piece.visible,
      uncertain: piece.uncertain,
      chunk,
    };
    piece.length = length;
    chunk.pieces.splice(pieceIndex + 1, 0, right);
    const eventPieces = this.piecesByEvent.get(piece.eventId)!;
    eventPieces.splice(eventPieces.indexOf(piece) + 1, 0, right);
  }

  private markGapUncertain(chunkIndex: number, pieceIndex: number): void {
    for (let index = chunkIndex; index < this.chunks.length; index++) {
      const pieces = this.chunks[index]!.pieces;
      for (
        let position = index === chunkIndex ? pieceIndex : 0;
        position < pieces.length;
        position++
      ) {
        const piece = pieces[position]!;
        if (piece.visible) {
          return;
        }
        piece.uncertain = true;
      }
    }
  }

  private rebalance(chunkIndex: number): void {
    const chunk = this.chunks[chunkIndex]!;
    if (chunk.pieces.length <= CHUNK_SPLIT_THRESHOLD) {
      return;
    }
    const replacement = chunkPieces(chunk.pieces);
    this.chunks.splice(chunkIndex, 1, ...replacement);
  }
}

const findPiece = (
  pieces: ReadonlyArray<Piece>,
  offset: number,
): Piece | undefined => {
  let low = 0;
  let high = pieces.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const piece = pieces[middle]!;
    if (offset < piece.start) {
      high = middle - 1;
    } else if (offset >= piece.start + piece.length) {
      low = middle + 1;
    } else {
      return piece;
    }
  }
  return undefined;
};

const chunkPieces = (pieces: ReadonlyArray<Piece>): Chunk[] => {
  const size = CHUNK_SPLIT_THRESHOLD / 2;
  const chunks: Chunk[] = [];
  for (let start = 0; start < pieces.length || chunks.length === 0; ) {
    const chunk: Chunk = {
      pieces: pieces.slice(start, start + size),
      visible: 0,
    };
    for (const piece of chunk.pieces) {
      piece.chunk = chunk;
      if (piece.visible) {
        chunk.visible += piece.length;
      }
    }
    chunks.push(chunk);
    start += size;
  }
  return chunks;
};

const resolveAtom = (
  projection: SequenceAnchorProjection,
  event: MirrorInsertEvent,
  offset: number,
): { readonly before: number; readonly visible: boolean } => {
  const before = tryResolveBoundary(projection, event.id, offset, "before");
  const after = tryResolveBoundary(projection, event.id, offset, "after");
  // A visible surrogate half cannot name the boundary inside its own pair.
  if (before === null && after !== null) {
    return { before: after - 1, visible: true };
  }
  if (before !== null && after === null) {
    return { before, visible: true };
  }
  if (before === null || after === null) {
    throw new Error(`Cannot project atom ${event.id}:${offset}`);
  }
  return { before, visible: after > before };
};

const tryResolveBoundary = (
  projection: SequenceAnchorProjection,
  eventId: string,
  offset: number,
  affinity: "before" | "after",
): number | null => {
  try {
    return projection.resolveAnchor({
      type: "atom",
      eventId,
      offset,
      affinity,
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes("surrogate pair")) {
      return null;
    }
    throw error;
  }
};
