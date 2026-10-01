import type { PackedLinearReplayView } from "../../graph/event-graph";
import type { PersistentUtf16Rope } from "../../text/persistent-utf16-rope";
import { TransientUtf16RopeEditor } from "../../text/transient-utf16-rope";
import {
  assertCodePointBoundary,
  assertDocumentIndex,
  type Utf16DocumentView,
} from "../invariants";

// A one-shot piece index costs one document rebuild when it is frozen. Below
// this many events, editing the persistent rope directly is cheaper.
export const MIN_TRANSIENT_CHAIN_EVENTS = 128;

/** A document a replay edits in place, then reads back as one rope. */
interface ReplayDocument extends Utf16DocumentView {
  insert(index: number, text: string): void;
  delete(index: number, length: number): void;
  finish(): PersistentUtf16Rope;
}

/** Edits a persistent rope directly, for a range too short to freeze. */
class PersistentReplayDocument implements ReplayDocument {
  constructor(private rope: PersistentUtf16Rope) {}

  get length(): number {
    return this.rope.length;
  }

  get hasSurrogateCodeUnits(): boolean {
    return this.rope.hasSurrogateCodeUnits;
  }

  codeUnitAt(index: number): number | undefined {
    return this.rope.codeUnitAt(index);
  }

  insert(index: number, text: string): void {
    this.rope = this.rope.insert(index, text);
  }

  delete(index: number, length: number): void {
    this.rope = this.rope.delete(index, length);
  }

  finish(): PersistentUtf16Rope {
    return this.rope;
  }
}

/**
 * Replay events `[startOffset, endOffset)` of a decoded exact chain onto the
 * document at `startOffset`, coalescing edits while validating every
 * operation.
 *
 * No version inside the range is observable, so a long range edits a
 * one-shot piece index and freezes it once instead of copying a leaf and its
 * path to the root on every edit.
 */
export const replayPackedLinear = (
  packed: PackedLinearReplayView,
  initialDocument: PersistentUtf16Rope,
  endOffset: number = packed.count,
  startOffset: number = 0,
): PersistentUtf16Rope => {
  const replay = new PackedLinearReplay(
    packed,
    initialDocument,
    endOffset,
    startOffset,
  );
  replay.advance(Number.POSITIVE_INFINITY);
  return replay.finish();
};

/**
 * {@link replayPackedLinear} for a caller that must pause between events.
 *
 * {@link advance} replays a bounded number of events and keeps the pending
 * coalesced edit and the piece index open, so a range replayed in several
 * calls makes exactly the edits one call would.
 */
export class PackedLinearReplay {
  private readonly document: ReplayDocument;
  private offset: number;
  private pendingKind: "insert" | "delete" | null = null;
  private pendingIndex = 0;
  private pendingLength = 0;
  private pendingContentStart = 0;
  private pendingContentEnd = 0;

  constructor(
    private readonly packed: PackedLinearReplayView,
    initialDocument: PersistentUtf16Rope,
    private readonly endOffset: number,
    startOffset: number,
  ) {
    this.document =
      endOffset - startOffset >= MIN_TRANSIENT_CHAIN_EVENTS
        ? new TransientUtf16RopeEditor(initialDocument)
        : new PersistentReplayDocument(initialDocument);
    this.offset = startOffset;
  }

  /** Whether every event of the range has been replayed. */
  get done(): boolean {
    return this.offset >= this.endOffset;
  }

  /** Replay up to `maxEvents` more events of the range. */
  advance(maxEvents: number): void {
    const packed = this.packed;
    const document = this.document;
    const endOffset = Math.min(this.endOffset, this.offset + maxEvents);
    for (let offset = this.offset; offset < endOffset; offset++) {
      const length = packed.operationLengthAt(offset);
      if (length === 0) {
        continue;
      }
      const index = packed.operationIndexAt(offset);

      if (packed.isInsertAt(offset)) {
        const contentStart = packed.insertStartAt(offset);
        if (
          this.pendingKind === "insert" &&
          index === this.pendingIndex + this.pendingLength &&
          contentStart === this.pendingContentEnd
        ) {
          this.pendingLength += length;
          this.pendingContentEnd += length;
          continue;
        }

        this.flush();
        assertDocumentIndex(index, true, document);
        assertCodePointBoundary(index, document);
        this.pendingKind = "insert";
        this.pendingIndex = index;
        this.pendingLength = length;
        this.pendingContentStart = contentStart;
        this.pendingContentEnd = contentStart + length;
        continue;
      }

      if (this.pendingKind === "delete" && index === this.pendingIndex) {
        const virtualDocumentLength = document.length - this.pendingLength;
        if (index + length > virtualDocumentLength) {
          throw new Error(
            `Delete range [${index}, ${index + length}) exceeds document length ${virtualDocumentLength}`,
          );
        }
        const combinedLength = this.pendingLength + length;
        assertCodePointBoundary(index + combinedLength, document);
        this.pendingLength = combinedLength;
        continue;
      }

      this.flush();
      assertDocumentIndex(index, false, document);
      assertCodePointBoundary(index, document);
      if (index + length > document.length) {
        throw new Error(
          `Delete range [${index}, ${index + length}) exceeds document length ${document.length}`,
        );
      }
      assertCodePointBoundary(index + length, document);
      this.pendingKind = "delete";
      this.pendingIndex = index;
      this.pendingLength = length;
    }
    this.offset = Math.max(this.offset, endOffset);
  }

  /** Apply the pending edit and freeze the document; the range must be done. */
  finish(): PersistentUtf16Rope {
    if (!this.done) {
      throw new Error(
        `Packed linear replay finished at offset ${this.offset} before ${this.endOffset}`,
      );
    }
    this.flush();
    return this.document.finish();
  }

  private flush(): void {
    if (this.pendingKind === "insert") {
      this.document.insert(
        this.pendingIndex,
        this.packed.sliceInsertedContent(
          this.pendingContentStart,
          this.pendingContentEnd,
        ),
      );
    } else if (this.pendingKind === "delete") {
      this.document.delete(this.pendingIndex, this.pendingLength);
    }
    this.pendingKind = null;
    this.pendingLength = 0;
  }
}
