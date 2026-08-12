import { describe, expect, it } from "vitest";
import { parsePresencePatch } from "./patch";

describe("parsePresencePatch", () => {
  it("accepts stable selection anchors and explicit clears", () => {
    const patch = parsePresencePatch({
      connectionId: "connection-1",
      userId: "user-1",
      clock: 3,
      updates: {
        cursor: null,
        selection: {
          anchor: {
            blockId: "block-a",
            anchor: { type: "boundary", edge: "start", affinity: "after" },
          },
          focus: {
            blockId: "block-b",
            anchor: { type: "boundary", edge: "end", affinity: "before" },
          },
        },
      },
    });

    expect(patch).toMatchObject({
      clock: 3,
      cursor: null,
      hasCursor: true,
      hasSelection: true,
    });
  });

  it("normalizes an offset cursor and legacy selection range", () => {
    const patch = parsePresencePatch({
      connectionId: "connection-1",
      userId: "user-1",
      clock: 1,
      updates: {
        cursor: { blockId: "b1", offset: 5 },
        selection: { blockId: "b1", from: 0, to: 5 },
        meta: { isTyping: true },
      },
    });
    expect(patch.cursor).toEqual({ blockId: "b1", offset: 5 });
    expect(patch.selection).toEqual({ blockId: "b1", from: 0, to: 5 });
    expect(patch.isTyping).toBe(true);
  });

  it("omits cursor/selection/isTyping when updates does not mention them", () => {
    const patch = parsePresencePatch({
      connectionId: "connection-1",
      userId: "user-1",
      clock: 1,
      updates: {},
    });
    expect(patch.hasCursor).toBe(false);
    expect(patch.hasSelection).toBe(false);
    expect(patch).not.toHaveProperty("cursor");
    expect(patch).not.toHaveProperty("selection");
    expect(patch).not.toHaveProperty("isTyping");
  });

  it("rejects malformed clocks and assigns stable profile colors", () => {
    expect(() =>
      parsePresencePatch({
        connectionId: "connection-1",
        userId: "user-1",
        clock: 0,
        updates: {},
      }),
    ).toThrow("invalid presence update");
  });

  it.each([
    ["a non-object payload", "nope"],
    ["a missing connectionId", { userId: "u", clock: 1, updates: {} }],
    ["a missing userId", { connectionId: "c", clock: 1, updates: {} }],
    [
      "a non-integer clock",
      { connectionId: "c", userId: "u", clock: 1.5, updates: {} },
    ],
    ["a missing updates object", { connectionId: "c", userId: "u", clock: 1 }],
  ])("rejects %s", (_case, value) => {
    expect(() => parsePresencePatch(value)).toThrow();
  });

  it("normalizes an unrecognized cursor shape to an explicit clear", () => {
    const patch = parsePresencePatch({
      connectionId: "c",
      userId: "u",
      clock: 1,
      updates: { cursor: { garbage: true } },
    });
    expect(patch.hasCursor).toBe(true);
    expect(patch.cursor).toBeNull();
  });

  it("normalizes an unrecognized selection shape to an explicit clear", () => {
    const patch = parsePresencePatch({
      connectionId: "c",
      userId: "u",
      clock: 1,
      updates: { selection: { garbage: true } },
    });
    expect(patch.hasSelection).toBe(true);
    expect(patch.selection).toBeNull();
  });

  it("rejects a non-boolean meta.isTyping", () => {
    expect(() =>
      parsePresencePatch({
        connectionId: "c",
        userId: "u",
        clock: 1,
        updates: { meta: { isTyping: "yes" } },
      }),
    ).toThrow("invalid presence metadata");
  });

  it("rejects a non-object meta", () => {
    expect(() =>
      parsePresencePatch({
        connectionId: "c",
        userId: "u",
        clock: 1,
        updates: { meta: "nope" },
      }),
    ).toThrow("invalid presence metadata");
  });
});
