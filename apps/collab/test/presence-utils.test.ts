import { describe, expect, it } from "vitest";
import {
  consumePresenceQuota,
  deterministicPresenceColor,
  parsePresencePatch,
} from "../server/utils/presence";

describe("presence transport guards", () => {
  it("resets a bounded rate window and rejects its overflow", () => {
    const first = consumePresenceQuota(null, 1_000, 2, 100);
    const second = consumePresenceQuota(first.state, 1_001, 2, 100);
    const rejected = consumePresenceQuota(second.state, 1_002, 2, 100);
    const reset = consumePresenceQuota(rejected.state, 1_100, 2, 100);

    expect([
      first.allowed,
      second.allowed,
      rejected.allowed,
      reset.allowed,
    ]).toEqual([true, true, false, true]);
  });

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

  it("rejects malformed clocks and assigns stable profile colors", () => {
    expect(() =>
      parsePresencePatch({
        connectionId: "connection-1",
        userId: "user-1",
        clock: 0,
        updates: {},
      }),
    ).toThrow("invalid presence update");
    expect(deterministicPresenceColor("user-1")).toBe(
      deterministicPresenceColor("user-1"),
    );
  });
});
