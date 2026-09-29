import { describe, expect, it } from "vitest";

import { OPERATION_TYPE } from "../constants/operation-types";
import { EventAlreadyExistsError } from "../graph/event-graph-errors";
import {
  LinearEventBatch,
  PackedLinearChain,
} from "../graph/internals/packed-linear-chain";
import type { PackedEventGraphBase } from "../graph/internals/packed-event-graph-base";
import type { ExternalOperation, GraphEvent, Version } from "../types";

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

/** Event objects of one chain; `appendEvents` reads no parents. */
const chainEvents = (
  entries: ReadonlyArray<
    readonly [id: string, operation: ExternalOperation, timestamp?: number]
  >,
): GraphEvent[] =>
  entries.map(([id, operation, timestamp = 0], offset) => ({
    id,
    parentVersion: new Set(offset === 0 ? [] : [entries[offset - 1]![0]]),
    operation,
    timestamp,
  }));

const insert = (index: number, text: string): ExternalOperation => ({
  type: OPERATION_TYPE.INSERT,
  index,
  text,
});

const remove = (index: number, length: number): ExternalOperation => ({
  type: OPERATION_TYPE.DELETE,
  index,
  length,
});

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

describe("PackedLinearChain.appendEvents", () => {
  it("packs event objects after a batch and reads them back", () => {
    const chain = new PackedLinearChain();
    chain.append(typing("a", 0, new Set(), "ab", 0));
    // Long enough to fill the first chunk and spill into two more.
    const entries = Array.from(
      { length: 3_000 },
      (_, offset) =>
        [
          `a:${offset + 2}`,
          offset % 3 === 2
            ? remove(offset, 1)
            : insert(offset + 2, offset % 2 === 0 ? "xy" : "z"),
          offset,
        ] as const,
    );
    const events = chainEvents(entries);

    const range = chain.appendEvents(events)!;

    expect(range.count).toBe(3_000);
    expect(range.idAt(0)).toBe("a:2");
    expect(range.idAt(3_000)).toBeUndefined();
    expect(range.lastId).toBe("a:3001");
    const text = events
      .map(({ operation }) =>
        operation.type === OPERATION_TYPE.INSERT ? operation.text : "",
      )
      .join("");
    expect(range.sliceInsertedContent(0, text.length)).toBe(text);
    events.forEach((event, offset) => {
      expect(range.operationAt(offset)).toEqual(event.operation);
      if (event.operation.type === OPERATION_TYPE.INSERT) {
        const start = range.insertStartAt(offset);
        expect(
          range.sliceInsertedContent(
            start,
            start + event.operation.text.length,
          ),
        ).toBe(event.operation.text);
      }
    });

    const base = chain.latest!;
    expect(base.count).toBe(3_002);
    expect(base.idAt(3_001)).toBe("a:3001");
    expect(base.parentOffsetAt(2, 0)).toBe(1);
    expect(operations(base).slice(2)).toEqual(
      events.map((event) => event.operation),
    );
    expect(base.timestampAt(3_001)).toBe(2_999);
    expect(base.sliceInsertedContent(0, 2 + text.length)).toBe(`ab${text}`);
  });

  it("widens a column when a later event does not fit it", () => {
    const wide = 0x1_0000_0000;
    const chain = new PackedLinearChain();
    const events = chainEvents([
      ["a:0", insert(0, "a"), 7],
      ["a:1", insert(wide, "b"), -1],
      ["a:2", remove(0, wide), 2 ** 40],
    ]);

    chain.appendEvents(events);

    expect(operations(chain.latest!)).toEqual(
      events.map((event) => event.operation),
    );
    expect(
      [0, 1, 2].map((offset) => chain.latest!.timestampAt(offset)),
    ).toEqual([7, -1, 2 ** 40]);
  });

  it("indexes canonical runs and non-canonical IDs", () => {
    const ids = [
      "plain",
      "a:01",
      "a:12345678901234567",
      "a:b:1",
      "a:b:2",
      "a:0",
      "a:1",
    ];
    const chain = new PackedLinearChain();

    chain.appendEvents(
      chainEvents(ids.map((id, offset) => [id, insert(offset, "x")] as const)),
    );

    const base = chain.latest!;
    expect([...base.iterateIds()]).toEqual(ids);
    expect(ids.map((id) => base.offsetOf(id))).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(base.has("a:1234567890123456")).toBe(false);
    expect(base.has("a:b:0")).toBe(false);
    expect(base.canonicalIdRunAt(0)).toBeUndefined();
    expect(base.canonicalIdRunAt(4)).toMatchObject({
      replicaId: "a:b",
      startSequence: 1,
      startEventOffset: 3,
    });
    expect(base.maximumSequenceForReplica("a")).toBe(1);
    expect(base.maximumSequenceForReplica("a:b")).toBe(2);
  });

  it.each([
    { name: "within the events", ids: ["a:2", "a:3", "a:2"] },
    { name: "already in the chain", ids: ["a:2", "a:3", "a:1"] },
    {
      name: "after the events spill into new chunks",
      ids: [
        ...Array.from({ length: 2_000 }, (_, offset) => `a:${offset + 2}`),
        "a:0",
      ],
    },
  ])("leaves the chain unchanged when an ID repeats $name", ({ ids }) => {
    const chain = new PackedLinearChain();
    const base = chain.append(typing("a", 0, new Set(), "ab", 0));
    const events = chainEvents(ids.map((id) => [id, insert(2, "c")] as const));

    expect(() => chain.appendEvents(events)).toThrow(EventAlreadyExistsError);

    expect(chain.latest).toBe(base);
    expect(chain.count).toBe(2);
    expect(chain.latest!.has("a:2")).toBe(false);
    chain.appendEvents(chainEvents([["a:2", insert(2, "d")]]));
    expect(operations(chain.latest!)).toEqual([
      insert(0, "a"),
      insert(1, "b"),
      insert(2, "d"),
    ]);
    expect(chain.latest!.sliceInsertedContent(0, 3)).toBe("abd");
  });

  it.each([
    { name: "a fractional timestamp", timestamp: 0.5 },
    { name: "an unsafe timestamp", timestamp: 2 ** 53 },
  ])("declines events with $name and changes nothing", ({ timestamp }) => {
    const chain = new PackedLinearChain();
    const base = chain.append(typing("a", 0, new Set(), "ab", 0));
    const events = chainEvents([
      ...Array.from(
        { length: 2_000 },
        (_, offset) => [`a:${offset + 2}`, insert(offset + 2, "c")] as const,
      ),
      ["a:2002", insert(2_002, "d"), timestamp],
    ]);

    expect(chain.appendEvents(events)).toBeNull();

    expect(chain.latest).toBe(base);
    expect(chain.count).toBe(2);
    expect(chain.latest!.has("a:2")).toBe(false);
    const range = chain.appendEvents(chainEvents([["a:2", insert(2, "e")]]))!;
    expect(range.operationAt(0)).toEqual(insert(2, "e"));
    expect(chain.latest!.sliceInsertedContent(0, 3)).toBe("abe");
  });
});
