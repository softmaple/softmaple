import { describe, expect, it } from "vitest";

import { OPERATION_TYPE } from "../constants/operation-types";
import { EventAlreadyExistsError } from "../graph/event-graph-errors";
import {
  LinearEventBatch,
  PackedLinearChain,
} from "../graph/internals/packed-linear-chain";
import type { PackedEventGraphBase } from "../graph/internals/packed-event-graph-base";
import type { ExternalOperation, Version } from "../types";

const typing = (
  replicaId: string,
  firstSequence: number,
  parents: Version,
  text: string,
  firstIndex: number,
): LinearEventBatch => {
  const batch = new LinearEventBatch(parents);
  for (let offset = 0; offset < text.length; offset++) {
    batch.appendInsert(
      `${replicaId}:${firstSequence + offset}`,
      firstIndex + offset,
      text[offset]!,
      firstSequence + offset,
    );
  }
  return batch.finish();
};

const operations = (base: PackedEventGraphBase): ExternalOperation[] =>
  Array.from({ length: base.count }, (_, offset) => base.operationAt(offset));

describe("LinearEventBatch", () => {
  it("joins inserted text once and reads per-event columns", () => {
    const batch = new LinearEventBatch(new Set(["p:0"]));
    batch.appendInsert("a:0", 0, "ab", 5);
    batch.appendDelete("a:1", 1, 1, 6);
    batch.appendInsert("a:2", 1, "c", 7.5);
    batch.finish();

    expect(batch.count).toBe(3);
    expect(batch.lastId).toBe("a:2");
    expect(batch.contentLength).toBe(3);
    expect(batch.insertedContent).toBe("abc");
    expect(batch.sliceInsertedContent(1, 3)).toBe("bc");
    expect(batch.operationAt(1)).toEqual({
      type: OPERATION_TYPE.DELETE,
      index: 1,
      length: 1,
    });
    expect(batch.timestampAt(2)).toBe(7.5);
    expect(batch.hasSafeIntegerTimestamps).toBe(false);
    expect(() => batch.appendDelete("a:3", 0, 0, 0)).toThrow(/finished/);
  });

  it("rejects reads that need content before finish", () => {
    const batch = new LinearEventBatch(new Set());
    expect(() => batch.lastId).toThrow(/empty/);
    batch.appendInsert("a:0", 0, "a", 0);
    expect(() => batch.insertedContent).toThrow(/before finish/);
    expect(() => batch.sliceInsertedContent(0, 1)).toThrow(/before finish/);
  });
});

describe("PackedLinearChain", () => {
  it("appends batches as one packed chain and loads columns on first read", () => {
    const chain = new PackedLinearChain();
    chain.append(typing("a", 0, new Set(), "abc", 0));
    const base = chain.append(typing("a", 3, new Set(["a:2"]), "de", 3));

    expect(base.count).toBe(5);
    expect(base.isExactLinear()).toBe(true);
    expect(base.idAt(4)).toBe("a:4");
    expect(base.parentOffsetAt(3, 0)).toBe(2);
    expect(operations(base).map((operation) => operation.index)).toEqual([
      0, 1, 2, 3, 4,
    ]);
    expect(base.sliceInsertedContent(0, 5)).toBe("abcde");
    expect(chain.latest).toBe(base);
  });

  it("keeps earlier bases readable across chunks and contiguous growth", () => {
    const chain = new PackedLinearChain();
    const text = "x".repeat(3_000);
    const first = chain.append(typing("a", 0, new Set(), text, 0));
    // Reading the first base makes the columns contiguous; later appends
    // then fill contiguous capacity or spill into chunks.
    expect(first.operationIndexAt(2_999)).toBe(2_999);
    let latest = first;
    for (let round = 1; round < 6; round++) {
      const start = round * 3_000;
      latest = chain.append(
        typing("a", start, new Set([`a:${start - 1}`]), text, start),
      );
      if (round === 3) {
        expect(latest.operationIndexAt(start)).toBe(start);
      }
    }

    expect(latest.count).toBe(18_000);
    expect(latest.operationIndexAt(17_999)).toBe(17_999);
    expect(latest.insertStartAt(17_999)).toBe(17_999);
    expect(first.count).toBe(3_000);
    expect(first.operationIndexAt(2_999)).toBe(2_999);
  });

  it("rolls back to a mark and appends a different batch", () => {
    const chain = new PackedLinearChain();
    const base = chain.append(typing("a", 0, new Set(), "ab", 0));
    const mark = chain.mark();
    const discarded = chain.append(typing("a", 2, new Set(["a:1"]), "cd", 2));
    chain.rollbackTo(mark);

    expect(chain.latest).toBe(base);
    expect(chain.count).toBe(2);
    expect(() => discarded.operationAt(3)).toThrow(/rolled back/);
    const replacement = chain.append(typing("b", 0, new Set(["a:1"]), "XY", 2));
    expect(replacement.sliceInsertedContent(0, 4)).toBe("abXY");
    expect(replacement.idAt(2)).toBe("b:0");
    expect(replacement.has("a:2")).toBe(false);
  });

  it("rolls back events that spilled into chunks", () => {
    const chain = new PackedLinearChain();
    chain.append(typing("a", 0, new Set(), "a".repeat(2_000), 0));
    const mark = chain.mark();
    chain.append(typing("a", 2_000, new Set(["a:1999"]), "b".repeat(2_000), 0));
    chain.rollbackTo(mark);
    const base = chain.append(
      typing("a", 2_000, new Set(["a:1999"]), "c".repeat(10), 0),
    );

    expect(base.count).toBe(2_010);
    expect(base.operationAt(2_005)).toEqual({
      type: OPERATION_TYPE.INSERT,
      index: 5,
      text: "c",
    });
  });

  it("leaves the chain unchanged when a batch repeats an ID", () => {
    const chain = new PackedLinearChain();
    const base = chain.append(typing("a", 0, new Set(), "ab", 0));
    const repeated = new LinearEventBatch(new Set(["a:1"]));
    repeated.appendInsert("a:2", 2, "c", 0);
    repeated.appendInsert("a:0", 3, "d", 0);

    expect(() => chain.append(repeated.finish())).toThrow(
      EventAlreadyExistsError,
    );
    expect(chain.latest).toBe(base);
    expect(chain.count).toBe(2);
    expect(chain.append(typing("a", 2, new Set(["a:1"]), "c", 2)).count).toBe(
      3,
    );
  });

  it("rejects batches it cannot pack", () => {
    const chain = new PackedLinearChain();
    const fractional = new LinearEventBatch(new Set());
    fractional.appendInsert("a:0", 0, "a", 0.5);

    expect(() => chain.append(fractional.finish())).toThrow(/safe-integer/);
    expect(chain.count).toBe(0);
  });
});
