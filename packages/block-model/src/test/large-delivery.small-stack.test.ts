import { beforeAll, describe, expect, it } from "vitest";

import {
  BLOCK_MODEL_SCHEMA_VERSION,
  BOOTSTRAP_BLOCK_ID,
  BOOTSTRAP_EVENT_ID,
  BlockReplica,
  type BlockReplicaOrigin,
  type RichTextEventBatch,
} from "../index";

/**
 * More batches than one call can take as arguments: the small-stack project in
 * vitest.config.ts runs this file with a 128 KiB stack, which holds at most
 * 16,384 of them.
 */
const BATCH_COUNT = 20_000;
/** Few enough batches to spread into one call on that stack. */
const CHUNK_SIZE = 5_000;

describe("BlockReplica with more batches than a spread can pass", () => {
  beforeAll(() => {
    expect(
      () => [].push(...new Array<never>(BATCH_COUNT)),
      "this file must run with the small-stack project's --stack-size",
    ).toThrow(RangeError);
  });

  it("should integrate them in one call and notify once", () => {
    // Arrange
    const receiver = new BlockReplica("receiver");
    const changes: { origin: BlockReplicaOrigin; batches: number }[] = [];
    receiver.subscribe(({ origin, batchIds }) => {
      changes.push({ origin, batches: batchIds.length });
    });

    // Act
    const result = receiver.applyRemoteEvents(typingHistory(BATCH_COUNT));

    // Assert
    expect(result.integratedBatchIds.length).toBe(BATCH_COUNT);
    expect(result.pendingBatchIds).toEqual([]);
    expect(changes).toEqual([{ origin: "remote", batches: BATCH_COUNT }]);
    expect(receiver.getDocument().blocks[0]?.text).toBe(
      "a".repeat(BATCH_COUNT),
    );
  });

  it("should keep them when a later transaction throws", () => {
    // Arrange
    const receiver = new BlockReplica("receiver");
    receiver.applyRemoteEvents(typingHistory(BATCH_COUNT));

    // Act
    expect(() =>
      receiver.transact((transaction) => {
        transaction.insertText(BOOTSTRAP_BLOCK_ID, 0, "lost");
        throw new Error("abort");
      }),
    ).toThrow("abort");

    // Assert
    expect(receiver.getDocument().blocks[0]?.text).toBe(
      "a".repeat(BATCH_COUNT),
    );
    expect(receiver.exportEvents().length).toBe(BATCH_COUNT + 1);
  });

  it("should deserialize a replica that received them over several calls", () => {
    // Arrange
    const batches = typingHistory(BATCH_COUNT);
    const source = new BlockReplica("source");
    for (let start = 0; start < BATCH_COUNT; start += CHUNK_SIZE) {
      source.applyRemoteEvents(batches.slice(start, start + CHUNK_SIZE));
    }

    // Act
    const restored = BlockReplica.deserialize(source.serialize(), "restored");

    // Assert
    expect(restored.getDocument()).toEqual(source.getDocument());
    expect(restored.exportEvents().length).toBe(BATCH_COUNT + 1);
  });
});

// Helpers

/** One author typing `count` characters, one single-event batch each. */
const typingHistory = (count: number): RichTextEventBatch[] =>
  Array.from({ length: count }, (_, index) => {
    const id = `history:${index}`;
    const parentVersion = [
      index === 0 ? BOOTSTRAP_EVENT_ID : `history:${index - 1}`,
    ];
    return {
      schemaVersion: BLOCK_MODEL_SCHEMA_VERSION,
      batchId: id,
      parentVersion,
      events: [
        {
          schemaVersion: BLOCK_MODEL_SCHEMA_VERSION,
          id,
          parentVersion,
          timestamp: index + 1,
          operation: { type: "insert", index: index + 1, text: "a" },
          effect: {
            type: "text-insert",
            blockId: BOOTSTRAP_BLOCK_ID,
            text: "a",
          },
        },
      ],
    };
  });
