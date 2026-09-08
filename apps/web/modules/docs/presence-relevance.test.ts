import { describe, expect, it } from "vitest";
import type { PresenceUser, StableCursorPosition } from "@softmaple/awareness";
import {
  PRESENCE_LIMITS,
  rankPresence,
} from "@/modules/docs/presence-relevance";

const anchor = (blockId: string): StableCursorPosition => ({
  blockId,
  anchor: { type: "boundary", edge: "start", affinity: "after" },
});

const peer = (
  connectionId: string,
  overrides: Partial<PresenceUser> = {},
): PresenceUser =>
  ({
    connectionId,
    userId: `user-${connectionId}`,
    name: connectionId,
    color: "#123456",
    status: "idle",
    lastActivityAt: 1_000,
    lastSeenAt: 1_000,
    clock: 1,
    cursor: anchor("block-1"),
    ...overrides,
  }) as PresenceUser;

const input = { now: 2_000, visibleBlockIds: null };

describe("rankPresence", () => {
  it("caps the drawn participants and counts the rest", () => {
    const users = Array.from({ length: 12 }, (_unused, index) =>
      peer(`c${index.toString().padStart(2, "0")}`),
    );
    const ranked = rankPresence(users, input);
    expect(ranked.detailed).toHaveLength(PRESENCE_LIMITS.DetailedParticipants);
    expect(ranked.expandedLabelIds.size).toBe(PRESENCE_LIMITS.ExpandedLabels);
    expect(ranked.overflowCount).toBe(
      12 - PRESENCE_LIMITS.DetailedParticipants,
    );
    expect(ranked.totalCount).toBe(12);
  });

  it("prefers people who are typing, then active, then recent", () => {
    const ranked = rankPresence(
      [
        peer("quiet", { lastActivityAt: 1 }),
        peer("recent", { lastActivityAt: 9_000 }),
        peer("active", { status: "active", lastActivityAt: 2 }),
        peer("typing", { lastActivityAt: 3, meta: { isTyping: true } }),
      ],
      input,
    );
    expect(ranked.detailed.map((user) => user.connectionId)).toEqual([
      "typing",
      "active",
      "recent",
      "quiet",
    ]);
  });

  it("prefers peers whose caret is on screen once visibility is known", () => {
    const ranked = rankPresence(
      [peer("offscreen", { cursor: anchor("far") }), peer("onscreen")],
      { now: 2_000, visibleBlockIds: new Set(["block-1"]) },
    );
    expect(ranked.detailed[0]?.connectionId).toBe("onscreen");
  });

  it("keeps the order stable when nothing distinguishes two peers", () => {
    const users = [peer("b"), peer("a")];
    expect(
      rankPresence(users, input).detailed.map((user) => user.connectionId),
    ).toEqual(["a", "b"]);
    expect(
      rankPresence([...users].reverse(), input).detailed.map(
        (user) => user.connectionId,
      ),
    ).toEqual(["a", "b"]);
  });

  it("excludes peers with no position but still counts them as present", () => {
    const ranked = rankPresence(
      [peer("here"), peer("nowhere", { cursor: undefined })],
      input,
    );
    expect(ranked.detailed.map((user) => user.connectionId)).toEqual(["here"]);
    expect(ranked.totalCount).toBe(2);
    expect(ranked.overflowCount).toBe(1);
  });

  it("draws nothing and claims nothing for an empty room", () => {
    const ranked = rankPresence([], input);
    expect(ranked.detailed).toHaveLength(0);
    expect(ranked.overflowCount).toBe(0);
    expect(ranked.totalCount).toBe(0);
  });
});
