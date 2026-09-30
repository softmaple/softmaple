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
  const document: ReplayDocument =
    endOffset - startOffset >= MIN_TRANSIENT_CHAIN_EVENTS
      ? new TransientUtf16RopeEditor(initialDocument)
      : new PersistentReplayDocument(initialDocument);
  let pendingKind: "insert" | "delete" | null = null;
  let pendingIndex = 0;
  let pendingLength = 0;
  let pendingContentStart = 0;
  let pendingContentEnd = 0;

  const flush = (): void => {
    if (pendingKind === "insert") {
      document.insert(
        pendingIndex,
        packed.sliceInsertedContent(pendingContentStart, pendingContentEnd),
      );
    } else if (pendingKind === "delete") {
      document.delete(pendingIndex, pendingLength);
    }
    pendingKind = null;
    pendingLength = 0;
  };

  for (let offset = startOffset; offset < endOffset; offset++) {
    const length = packed.operationLengthAt(offset);
    if (length === 0) {
      continue;
    }
    const index = packed.operationIndexAt(offset);

    if (packed.isInsertAt(offset)) {
      const contentStart = packed.insertStartAt(offset);
      if (
        pendingKind === "insert" &&
        index === pendingIndex + pendingLength &&
        contentStart === pendingContentEnd
      ) {
        pendingLength += length;
        pendingContentEnd += length;
        continue;
      }

      flush();
      assertDocumentIndex(index, true, document);
      assertCodePointBoundary(index, document);
      pendingKind = "insert";
      pendingIndex = index;
      pendingLength = length;
      pendingContentStart = contentStart;
      pendingContentEnd = contentStart + length;
      continue;
    }

    if (pendingKind === "delete" && index === pendingIndex) {
      const virtualDocumentLength = document.length - pendingLength;
      if (index + length > virtualDocumentLength) {
        throw new Error(
          `Delete range [${index}, ${index + length}) exceeds document length ${virtualDocumentLength}`,
        );
      }
      const combinedLength = pendingLength + length;
      assertCodePointBoundary(index + combinedLength, document);
      pendingLength = combinedLength;
      continue;
    }

    flush();
    assertDocumentIndex(index, false, document);
    assertCodePointBoundary(index, document);
    if (index + length > document.length) {
      throw new Error(
        `Delete range [${index}, ${index + length}) exceeds document length ${document.length}`,
      );
    }
    assertCodePointBoundary(index + length, document);
    pendingKind = "delete";
    pendingIndex = index;
    pendingLength = length;
  }

  flush();
  return document.finish();
};
