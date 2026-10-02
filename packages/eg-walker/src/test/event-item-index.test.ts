import { describe, expect, it } from "vitest";

import type { AugmentedCRDTItem } from "../engine/internals/engine-types";
import { EventItemIndex } from "../engine/internals/event-item-index";
import { crdtItem } from "./test-helpers";

// Events are canonical `agent:sequence` IDs; each test graph maps local
// version `agent * 100 + sequence` to that pair. Local version -1 stands for
// a custom event ID.
const AGENT_REPLICA = 0;
const AGENT_AUTHOR = 1;
const AGENT_OTHER = 2;
const CUSTOM = 999;
const lv = (agent: number, sequence: number): number => agent * 100 + sequence;

const createIndex = (): EventItemIndex =>
  new EventItemIndex({
    agentAt: (localVersion) =>
      localVersion === CUSTOM ? -1 : Math.floor(localVersion / 100),
    sequenceAt: (localVersion) => localVersion % 100,
  });

let nextKey = 1;
const keys = new Map<string, number>();
const keyOf = (name: string): number => {
  let key = keys.get(name);
  if (key === undefined) {
    key = nextKey++;
    keys.set(name, key);
  }
  return key;
};

const runItem = (
  name: string,
  agent: number,
  startSequence: number,
  content: string,
): AugmentedCRDTItem =>
  crdtItem({
    id: keyOf(name),
    agent,
    sequence: startSequence,
    offset: 0,
    content,
    originLeft: null,
    originRight: null,
    everDeleted: false,
    prepareState: 1,
    run: true,
  });

describe("EventItemIndex typed-run ranges", () => {
  it("resolves repeated splits without per-event direct entries", () => {
    const index = createIndex();
    const left = runItem("left", AGENT_REPLICA, 0, "abcdef");
    index.registerRunItem(left);

    expect(index.get(lv(AGENT_REPLICA, 0))).toBe(keyOf("left"));
    expect(index.get(lv(AGENT_REPLICA, 5))).toBe(keyOf("left"));

    left.content = "ab";
    const middle = runItem("middle", AGENT_REPLICA, 2, "cdef");
    index.registerRunItem(middle);
    middle.content = "cd";
    const right = runItem("right", AGENT_REPLICA, 4, "ef");
    index.registerRunItem(right);

    expect(
      Array.from({ length: 6 }, (_, sequence) =>
        index.get(lv(AGENT_REPLICA, sequence)),
      ),
    ).toEqual(
      ["left", "left", "middle", "middle", "right", "right"].map(keyOf),
    );
  });

  it("keeps out-of-order non-overlapping runs searchable", () => {
    const index = createIndex();
    const late = runItem("late", AGENT_AUTHOR, 10, "klm");
    const early = runItem("early", AGENT_AUTHOR, 0, "abcdefghij");
    const other = runItem("other", AGENT_OTHER, 5, "xyz");

    index.registerRunItem(late);
    index.registerRunItem(early);
    index.registerRunItem(other);

    expect(index.get(lv(AGENT_AUTHOR, 9))).toBe(keyOf("early"));
    expect(index.get(lv(AGENT_AUTHOR, 10))).toBe(keyOf("late"));
    expect(index.get(lv(AGENT_AUTHOR, 13))).toBeUndefined();
    expect(index.get(lv(AGENT_OTHER, 6))).toBe(keyOf("other"));
    expect(index.get(CUSTOM)).toBeUndefined();
  });

  it("bounds in-place extension at an out-of-order successor", () => {
    const index = createIndex();
    const later = runItem("later", AGENT_AUTHOR, 2, "c");
    const earlier = runItem("earlier", AGENT_AUTHOR, 0, "a");

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
    const index = createIndex();
    const item = runItem("run", AGENT_REPLICA, 3, "abcd");
    index.registerRunItem(item);
    index.registerRunItem(item);

    expect(() =>
      index.registerRunItem(runItem("overlap-left", AGENT_REPLICA, 2, "xx")),
    ).toThrow("overlaps");
    expect(() =>
      index.registerRunItem(runItem("overlap-right", AGENT_REPLICA, 6, "xx")),
    ).toThrow("overlaps");

    index.clear();
    expect(index.get(lv(AGENT_REPLICA, 3))).toBeUndefined();
  });

  it("extends only runs registered since the last clear of the same index", () => {
    // Arrange
    const index = createIndex();
    const other = createIndex();
    const cleared = runItem("cleared", AGENT_REPLICA, 0, "a");
    const foreign = runItem("foreign", AGENT_AUTHOR, 0, "a");
    index.registerRunItem(cleared);
    other.registerRunItem(foreign);

    // Act
    index.clear();

    // Assert
    expect(index.canExtendRunItem(cleared, 1)).toBe(false);
    expect(index.canExtendRunItem(foreign, 1)).toBe(false);
    expect(other.canExtendRunItem(foreign, 1)).toBe(true);
    index.registerRunItem(cleared);
    expect(index.canExtendRunItem(cleared, 1)).toBe(true);
  });
});
