import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  BOOTSTRAP_BLOCK_ID,
  BlockReplica,
  type BlockType,
  type RichTextEventBatch,
} from "../../index";

describe("property: rich-text event DAG convergence", () => {
  it("should converge under out-of-order duplicate batch delivery", () => {
    fc.assert(
      fc.property(
        fc.string(),
        fc.string(),
        fc.constantFrom<BlockType>(
          "paragraph",
          "h1",
          "h2",
          "h3",
          "quote",
          "code",
        ),
        fc.boolean(),
        fc.tuple(fc.integer(), fc.integer(), fc.integer()),
        (leftText, rightText, blockType, useBold, priorities) => {
          // Arrange
          const base = new BlockReplica("seed");
          base.transact((transaction) => {
            transaction.insertText(BOOTSTRAP_BLOCK_ID, 0, "base:");
          });
          const left = BlockReplica.deserialize(base.serialize(), "left");
          const right = BlockReplica.deserialize(base.serialize(), "right");
          const leftInsert = left.transact((transaction) => {
            transaction.replaceDocument({
              blocks: [
                {
                  id: BOOTSTRAP_BLOCK_ID,
                  type: "paragraph",
                  text: `base:${leftText}`,
                },
              ],
            });
          });
          const leftFollowup = left.transact((transaction) => {
            transaction.setBlock(BOOTSTRAP_BLOCK_ID, { type: blockType });
            if (useBold && leftText.length > 0) {
              transaction.setMark(
                BOOTSTRAP_BLOCK_ID,
                0,
                leftText.length,
                "bold",
                true,
              );
            }
          });
          const rightInsert = right.transact((transaction) => {
            transaction.replaceDocument({
              blocks: [
                {
                  id: BOOTSTRAP_BLOCK_ID,
                  type: "paragraph",
                  text: `base:${rightText}`,
                },
              ],
            });
          });
          const batches = [leftInsert, leftFollowup, rightInsert].filter(
            (batch): batch is RichTextEventBatch => batch !== null,
          );
          const first = BlockReplica.deserialize(base.serialize(), "first");
          const second = BlockReplica.deserialize(base.serialize(), "second");
          const shuffled = batches
            .map((batch, index) => ({ batch, priority: priorities[index]! }))
            .sort(
              (leftEntry, rightEntry) =>
                leftEntry.priority - rightEntry.priority ||
                leftEntry.batch.batchId.localeCompare(rightEntry.batch.batchId),
            )
            .map(({ batch }) => batch);

          // Act
          for (const batch of [...shuffled, ...shuffled]) {
            first.applyRemoteEvents(batch);
          }
          for (const batch of [...batches.slice().reverse(), ...batches]) {
            second.applyRemoteEvents(batch);
          }

          // Assert
          expect(first.getDocument()).toEqual(second.getDocument());
          expect(first.serialize()).toEqual(second.serialize());
          expect(first.applyRemoteEvents(batches).pendingBatchIds).toEqual([]);
        },
      ),
      { numRuns: 60 },
    );
  });
});
