import type { PackedLinearReplayView } from "../../graph/event-graph";
import type { PersistentUtf16Rope } from "../../text/persistent-utf16-rope";
import { assertCodePointBoundary, assertDocumentIndex } from "../invariants";

/** Replay a decoded exact chain, coalescing edits while validating every operation. */
export const replayPackedLinear = (
  packed: PackedLinearReplayView,
  initialDocument: PersistentUtf16Rope,
  endOffset: number = packed.count,
): PersistentUtf16Rope => {
  let document = initialDocument;
  let pendingKind: "insert" | "delete" | null = null;
  let pendingIndex = 0;
  let pendingLength = 0;
  let pendingContentStart = 0;
  let pendingContentEnd = 0;

  const flush = (): void => {
    if (pendingKind === "insert") {
      document = document.insert(
        pendingIndex,
        packed.sliceInsertedContent(pendingContentStart, pendingContentEnd),
      );
    } else if (pendingKind === "delete") {
      document = document.delete(pendingIndex, pendingLength);
    }
    pendingKind = null;
    pendingLength = 0;
  };

  for (let offset = 0; offset < endOffset; offset++) {
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
  return document;
};
