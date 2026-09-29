/**
 * Synthetic block-model typing histories for edit-latency benchmarks.
 *
 * The builders only produce JSON-safe batches, so the same history can be fed
 * to any `@softmaple/block-model` build. Constants come from the build being
 * measured, which keeps a base and a head build on identical inputs.
 */

import type { RichTextEvent, RichTextEventBatch } from "@softmaple/block-model";

/** The block-model constants a history needs. */
export interface BlockModelConstants {
  readonly BLOCK_MARKER: string;
  readonly BLOCK_MODEL_SCHEMA_VERSION: 1;
  readonly BOOTSTRAP_BLOCK_ID: string;
  readonly BOOTSTRAP_EVENT_ID: string;
}

export interface TypingHistory {
  /** One single-event batch per history step, in causal order. */
  readonly batches: ReadonlyArray<RichTextEventBatch>;
  /** Text of every block the history creates, in document order. */
  readonly blockTexts: ReadonlyArray<string>;
  readonly lastBlockId: string;
  /** Raw sequence length: one marker per block plus every typed character. */
  readonly rawLength: number;
  readonly lastEventId: string;
}

const TYPED = "the quick brown fox jumps over a lazy dog ";

const PARAGRAPH_FIELDS = {
  type: "paragraph",
  parentId: null,
  language: null,
  theme: null,
  start: null,
  value: null,
  checked: null,
} as const;

/**
 * A single author typing `batchCount` one-character batches at the end of the
 * document. With a positive `paragraphLength`, a new paragraph starts whenever
 * the current one reaches that many characters; that step is a block-create
 * batch instead of a character.
 */
export const buildTypingHistory = (
  model: BlockModelConstants,
  batchCount: number,
  paragraphLength = 0,
): TypingHistory => {
  const batches: RichTextEventBatch[] = [];
  const blockIds = [model.BOOTSTRAP_BLOCK_ID];
  const blockTexts = [""];
  let parent = model.BOOTSTRAP_EVENT_ID;
  let rawLength = 1;
  for (let index = 0; index < batchCount; index++) {
    const id = `history:${index}`;
    const current = blockTexts.length - 1;
    const opensParagraph =
      paragraphLength > 0 && blockTexts[current]!.length >= paragraphLength;
    const character = TYPED[index % TYPED.length]!;
    const event: RichTextEvent = {
      schemaVersion: model.BLOCK_MODEL_SCHEMA_VERSION,
      id,
      parentVersion: [parent],
      timestamp: index + 1,
      operation: {
        type: "insert",
        index: rawLength,
        text: opensParagraph ? model.BLOCK_MARKER : character,
      },
      effect: opensParagraph
        ? {
            type: "block-create",
            blockId: id,
            sourceBlockId: null,
            fields: PARAGRAPH_FIELDS,
          }
        : { type: "text-insert", blockId: blockIds[current]!, text: character },
    };
    if (opensParagraph) {
      blockIds.push(id);
      blockTexts.push("");
    } else {
      blockTexts[current] += character;
    }
    batches.push({
      schemaVersion: model.BLOCK_MODEL_SCHEMA_VERSION,
      batchId: id,
      parentVersion: [parent],
      events: [event],
    });
    parent = id;
    rawLength++;
  }
  return {
    batches,
    blockTexts,
    lastBlockId: blockIds.at(-1)!,
    rawLength,
    lastEventId: parent,
  };
};

/**
 * One character typed by a remote peer that has seen everything up to
 * `parentEventId`, at raw index `rawIndex` inside `blockId`.
 */
export const buildRemoteTypingBatch = (
  model: BlockModelConstants,
  eventId: string,
  parentEventId: string,
  rawIndex: number,
  blockId: string,
  text: string,
): RichTextEventBatch => ({
  schemaVersion: model.BLOCK_MODEL_SCHEMA_VERSION,
  batchId: eventId,
  parentVersion: [parentEventId],
  events: [
    {
      schemaVersion: model.BLOCK_MODEL_SCHEMA_VERSION,
      id: eventId,
      parentVersion: [parentEventId],
      timestamp: 1,
      operation: { type: "insert", index: rawIndex, text },
      effect: { type: "text-insert", blockId, text },
    },
  ],
});

export const median = (values: ReadonlyArray<number>): number => {
  if (values.length === 0) {
    throw new Error("Cannot take the median of no samples");
  }
  const sorted = [...values].sort((left, right) => left - right);
  const middle = sorted.length >> 1;
  return sorted.length % 2 === 1
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
};
