import { describe, expect, it } from "vitest";

import { EventAlreadyExistsError } from "../graph/event-graph-errors";
import { EventIdRunIndex } from "../graph/internals/event-id-run-index";

const appendAll = (
  index: EventIdRunIndex,
  ids: ReadonlyArray<string>,
): void => {
  for (const id of ids) {
    index.append(id);
  }
};

describe("EventIdRunIndex", () => {
  it("stores consecutive canonical IDs as one run", () => {
    const index = new EventIdRunIndex();
    appendAll(index, ["a:0", "a:1", "a:2", "b:7", "b:8"]);
    const view = index.view();

    expect(view.count).toBe(5);
    expect([...view.iterateIds()]).toEqual(["a:0", "a:1", "a:2", "b:7", "b:8"]);
    expect(view.offsetOf("a:2")).toBe(2);
    expect(view.offsetOf("b:8")).toBe(4);
    expect(view.idAt(3)).toBe("b:7");
    expect(view.canonicalRunAt?.(1)).toMatchObject({
      replicaId: "a",
      startSequence: 0,
      startEventOffset: 0,
    });
    expect(view.maximumSequenceForReplica("a")).toBe(2);
    expect(view.maximumSequenceForReplica("missing")).toBeUndefined();
  });

  it("indexes custom IDs verbatim", () => {
    const index = new EventIdRunIndex();
    appendAll(index, ["a:01", "plain", "a:", ":5", "a:0"]);
    const view = index.view();

    expect([...view.iterateIds()]).toEqual([
      "a:01",
      "plain",
      "a:",
      ":5",
      "a:0",
    ]);
    expect(view.offsetOf("plain")).toBe(1);
    expect(view.offsetOf("a:01")).toBe(0);
    expect(view.offsetOf("a:1")).toBeUndefined();
    expect(view.canonicalRunAt?.(1)).toBeUndefined();
    expect(view.maximumSequenceForReplica("a")).toBe(0);
  });

  it("keeps an over-long suffix custom and splits at the last colon", () => {
    const index = new EventIdRunIndex();
    appendAll(index, ["a:12345678901234567", "a:b:1", "a:b:2", "a:1"]);
    const view = index.view();

    expect(view.canonicalRunAt?.(0)).toBeUndefined();
    expect(view.offsetOf("a:12345678901234567")).toBe(0);
    expect(view.offsetOf("a:1234567890123456")).toBeUndefined();
    expect(view.canonicalRunAt?.(2)).toMatchObject({
      replicaId: "a:b",
      startSequence: 1,
      startEventOffset: 1,
      length: 2,
    });
    expect(view.offsetOf("a:b:2")).toBe(2);
    expect(view.offsetOf("a:1")).toBe(3);
    expect(view.maximumSequenceForReplica("a:b")).toBe(2);
    expect(view.maximumSequenceForReplica("a")).toBe(1);
  });

  it.each([
    { name: "inside the growing run", ids: ["a:0", "a:1", "a:0"] },
    { name: "inside an older run", ids: ["a:5", "a:6", "b:0", "a:6"] },
    { name: "a repeated custom ID", ids: ["x", "y", "x"] },
  ])("rejects a duplicate $name and keeps the index", ({ ids }) => {
    const index = new EventIdRunIndex();
    appendAll(index, ids.slice(0, -1));
    const before = [...index.view().iterateIds()];

    expect(() => index.append(ids.at(-1)!)).toThrow(EventAlreadyExistsError);
    expect([...index.view().iterateIds()]).toEqual(before);
  });

  it("does not grow a run into the next run of the same replica", () => {
    const index = new EventIdRunIndex();
    appendAll(index, ["a:10", "a:0", "a:1"]);

    expect(() => index.append("a:10")).toThrow(EventAlreadyExistsError);
    index.append("a:9");
    expect(index.view().offsetOf("a:9")).toBe(3);
    expect(index.view().maximumSequenceForReplica("a")).toBe(10);
  });

  it("keeps earlier views fixed while the index grows", () => {
    const index = new EventIdRunIndex();
    appendAll(index, ["a:0", "a:1"]);
    const early = index.view();
    appendAll(index, ["a:2", "b:0"]);

    expect(early.count).toBe(2);
    expect(early.has("a:2")).toBe(false);
    expect(early.idAt(2)).toBeUndefined();
    expect([...early.iterateIds()]).toEqual(["a:0", "a:1"]);
    expect(early.maximumSequenceForReplica("a")).toBe(1);
    expect(early.maximumSequenceForReplica("b")).toBeUndefined();
    expect(index.view().has("a:2")).toBe(true);
  });

  it("truncates runs and custom IDs, and appends again afterwards", () => {
    const index = new EventIdRunIndex();
    appendAll(index, ["a:0", "a:1", "x", "b:0", "a:2"]);
    index.truncate(2);

    expect([...index.view().iterateIds()]).toEqual(["a:0", "a:1"]);
    expect(index.view().has("x")).toBe(false);
    expect(index.view().has("b:0")).toBe(false);
    appendAll(index, ["a:2", "x", "b:0"]);
    expect([...index.view().iterateIds()]).toEqual([
      "a:0",
      "a:1",
      "a:2",
      "x",
      "b:0",
    ]);
    index.truncate(1);
    expect([...index.view().iterateIds()]).toEqual(["a:0"]);
    expect(() => index.truncate(2)).toThrow(/Cannot truncate/);
  });

  it("returns nothing for offsets outside a view", () => {
    const index = new EventIdRunIndex();
    appendAll(index, ["a:0"]);
    const view = index.view();

    expect(view.idAt(-1)).toBeUndefined();
    expect(view.idAt(1)).toBeUndefined();
    expect(view.idAt(0.5)).toBeUndefined();
    expect(view.canonicalRunAt?.(1)).toBeUndefined();
  });
});
