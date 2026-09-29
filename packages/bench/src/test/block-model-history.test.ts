import { describe, expect, it } from "vitest";

import * as model from "@softmaple/block-model";
import {
  buildRemoteTypingBatch,
  buildTypingHistory,
  median,
} from "../bench/block-model-history";

describe("buildTypingHistory", () => {
  it("should type every batch into the bootstrap paragraph by default", () => {
    // Arrange
    const history = buildTypingHistory(model, 12);
    const replica = new model.BlockReplica("receiver");

    // Act
    const result = replica.applyRemoteEvents(history.batches);

    // Assert
    expect(result.pendingBatchIds).toEqual([]);
    expect(replica.getDocument().blocks.map(({ text }) => text)).toEqual([
      "the quick br",
    ]);
    expect(history.blockTexts).toEqual(["the quick br"]);
    expect(history.rawLength).toBe(13);
  });

  it("should start a new paragraph whenever the current one is full", () => {
    // Arrange
    const history = buildTypingHistory(model, 9, 4);
    const replica = new model.BlockReplica("receiver");

    // Act
    replica.applyRemoteEvents(history.batches);

    // Assert
    expect(replica.getDocument().blocks.map(({ text }) => text)).toEqual([
      "the ",
      "uick",
    ]);
    expect(replica.getDocument().blocks.at(-1)?.id).toBe(history.lastBlockId);
  });
});

describe("buildRemoteTypingBatch", () => {
  it("should append a remote character after the latest history event", () => {
    // Arrange
    const history = buildTypingHistory(model, 3, 0);
    const replica = new model.BlockReplica("receiver");
    replica.applyRemoteEvents(history.batches);
    const batch = buildRemoteTypingBatch(
      model,
      "peer:0",
      history.lastEventId,
      history.rawLength,
      history.lastBlockId,
      "!",
    );

    // Act
    const result = replica.applyRemoteEvents(batch);

    // Assert
    expect(result.integratedBatchIds).toEqual(["peer:0"]);
    expect(replica.getDocument().blocks[0]?.text).toBe("the!");
  });
});

describe("median", () => {
  it("should pick the middle sample regardless of input order", () => {
    // Arrange / Act / Assert
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});
