import { describe, expect, it } from "vitest";

import type { AugmentedCRDTItem } from "../engine/internals/engine-types";
import { EventItemIndex } from "../engine/internals/event-item-index";

const runItem = (
  id: string,
  replicaId: string,
  startSequence: number,
  content: string,
): AugmentedCRDTItem => ({
  id,
  eventId: `${replicaId}:${startSequence}`,
  content,
  originLeft: null,
  originRight: null,
  everDeleted: false,
  prepareState: 1,
  run: { replicaId, startSequence },
});

describe("EventItemIndex typed-run ranges", () => {
  it("resolves repeated splits without per-event direct entries", () => {
    const index = new EventItemIndex();
    const left = runItem("left", "replica", 0, "abcdef");
    index.registerRunItem(left);

    expect(index.get("replica:0")).toBe("left");
    expect(index.get("replica:5")).toBe("left");

    left.content = "ab";
    const middle = runItem("middle", "replica", 2, "cdef");
    index.registerRunItem(middle);
    middle.content = "cd";
    const right = runItem("right", "replica", 4, "ef");
    index.registerRunItem(right);

    expect(
      Array.from({ length: 6 }, (_, sequence) =>
        index.get(`replica:${sequence}`),
      ),
    ).toEqual(["left", "left", "middle", "middle", "right", "right"]);
  });

  it("keeps out-of-order non-overlapping runs searchable", () => {
    const index = new EventItemIndex();
    const late = runItem("late", "author", 10, "klm");
    const early = runItem("early", "author", 0, "abcdefghij");
    const other = runItem("other", "other", 5, "xyz");

    index.registerRunItem(late);
    index.registerRunItem(early);
    index.registerRunItem(other);

    expect(index.get("author:9")).toBe("early");
    expect(index.get("author:10")).toBe("late");
    expect(index.get("author:13")).toBeUndefined();
    expect(index.get("other:6")).toBe("other");
    expect(index.get("custom-id")).toBeUndefined();
  });

  it("bounds in-place extension at an out-of-order successor", () => {
    const index = new EventItemIndex();
    const later = runItem("later", "author", 2, "c");
    const earlier = runItem("earlier", "author", 0, "a");

    index.registerRunItem(later);
    index.registerRunItem(earlier);

    expect(index.canExtendRunItem(earlier, 1)).toBe(true);
    earlier.content = "ab";
    expect(index.canExtendRunItem(earlier, 1)).toBe(false);
    expect(() => index.registerRunItem(earlier)).not.toThrow();

    earlier.content = "abc";
    expect(() => index.registerRunItem(earlier)).toThrow("overlaps");
  });

  it("rejects overlaps, permits idempotent registration, and clears roots", () => {
    const index = new EventItemIndex();
    const item = runItem("run", "replica", 3, "abcd");
    index.registerRunItem(item);
    index.registerRunItem(item);

    expect(() =>
      index.registerRunItem(runItem("overlap-left", "replica", 2, "xx")),
    ).toThrow("overlaps");
    expect(() =>
      index.registerRunItem(runItem("overlap-right", "replica", 6, "xx")),
    ).toThrow("overlaps");

    index.clear();
    expect(index.get("replica:3")).toBeUndefined();
  });
});
