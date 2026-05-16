import { describe, expect, it, vi } from "vitest";
import type { PositionMapper } from "../resolver";
import { createPresenceUser } from "../types/presence";
import type { PresenceState } from "../types/state";
import { remapRemotePositions } from "./cursor-operations";
import { createInitialPresenceState } from "./selectors";

const makeUser = (
  userId: string,
  overrides: Partial<ReturnType<typeof createPresenceUser>> = {},
) => ({
  ...createPresenceUser({ userId, name: `User ${userId}`, color: "#000" }),
  ...overrides,
});

const makeState = (
  users: ReadonlyArray<ReturnType<typeof makeUser>>,
  selfId: string | null = "self",
): PresenceState => ({
  ...createInitialPresenceState(),
  selfId,
  users: new Map(users.map((user) => [user.userId, user])),
});

const insertAt = (at: number, length: number): PositionMapper => ({
  mapPosition: ({ blockId, offset }) => ({
    blockId,
    offset: offset >= at ? offset + length : offset,
  }),
});

const deleteRange = (from: number, to: number): PositionMapper => ({
  mapPosition: ({ blockId, offset }) => {
    if (offset > from && offset <= to) return null;
    if (offset > to) return { blockId, offset: offset - (to - from) };
    return { blockId, offset };
  },
});

describe("remapRemotePositions", () => {
  it("shifts a remote selection forward for insertion before it", () => {
    const state = makeState([
      makeUser("self"),
      makeUser("peer", { selection: { blockId: "body", from: 6, to: 11 } }),
    ]);

    const next = remapRemotePositions(state, insertAt(0, 4));

    expect(next.users.get("peer")?.selection).toEqual({
      blockId: "body",
      from: 10,
      to: 15,
    });
  });

  it("shifts a remote selection backward for deletion before it", () => {
    const state = makeState([
      makeUser("self"),
      makeUser("peer", { selection: { blockId: "body", from: 10, to: 15 } }),
    ]);

    const next = remapRemotePositions(state, deleteRange(0, 4));

    expect(next.users.get("peer")?.selection).toEqual({
      blockId: "body",
      from: 6,
      to: 11,
    });
  });

  it("extends a remote selection for insertion inside it", () => {
    const state = makeState([
      makeUser("self"),
      makeUser("peer", { selection: { blockId: "body", from: 6, to: 11 } }),
    ]);

    const next = remapRemotePositions(state, insertAt(8, 4));

    expect(next.users.get("peer")?.selection).toEqual({
      blockId: "body",
      from: 6,
      to: 15,
    });
  });

  it("clears a remote selection when a mapped endpoint no longer exists", () => {
    const state = makeState([
      makeUser("self"),
      makeUser("peer", { selection: { blockId: "body", from: 6, to: 11 } }),
    ]);

    const next = remapRemotePositions(state, deleteRange(8, 12));

    expect(next.users.get("peer")?.selection).toBeUndefined();
  });

  it("composes multiple local edits in sequence for multiple users", () => {
    const state = makeState([
      makeUser("self"),
      makeUser("a", { cursor: { blockId: "body", offset: 6 } }),
      makeUser("b", { selection: { blockId: "body", from: 12, to: 18 } }),
    ]);

    const afterInsert = remapRemotePositions(state, insertAt(0, 4));
    const afterDelete = remapRemotePositions(afterInsert, deleteRange(5, 7));

    expect(afterDelete.users.get("a")?.cursor).toEqual({
      blockId: "body",
      offset: 8,
    });
    expect(afterDelete.users.get("b")?.selection).toEqual({
      blockId: "body",
      from: 14,
      to: 20,
    });
  });

  it("does not remap the self user", () => {
    const state = makeState([
      makeUser("self", {
        cursor: { blockId: "body", offset: 6 },
        selection: { blockId: "body", from: 6, to: 11 },
      }),
    ]);

    const next = remapRemotePositions(state, insertAt(0, 4));

    expect(next.users.get("self")?.cursor).toEqual({
      blockId: "body",
      offset: 6,
    });
    expect(next.users.get("self")?.selection).toEqual({
      blockId: "body",
      from: 6,
      to: 11,
    });
  });

  it("does not remap pointers or anchored positions", () => {
    const state = makeState([
      makeUser("self"),
      makeUser("peer", {
        cursor: { blockId: "body", offset: 6, anchor: "cursor-anchor" },
        selection: {
          blockId: "body",
          from: 6,
          to: 11,
          fromAnchor: "from-anchor",
          toAnchor: "to-anchor",
        },
        pointer: { x: 10, y: 20, space: "viewport" },
      }),
    ]);

    const next = remapRemotePositions(state, insertAt(0, 4));

    expect(next.users.get("peer")?.cursor).toEqual({
      blockId: "body",
      offset: 6,
      anchor: "cursor-anchor",
    });
    expect(next.users.get("peer")?.selection).toEqual({
      blockId: "body",
      from: 6,
      to: 11,
      fromAnchor: "from-anchor",
      toAnchor: "to-anchor",
    });
    expect(next.users.get("peer")?.pointer).toEqual({
      x: 10,
      y: 20,
      space: "viewport",
    });
  });

  it("is pure and does not call external send functions", () => {
    const send = vi.fn();
    const state = makeState([
      makeUser("self"),
      makeUser("peer", { cursor: { blockId: "body", offset: 6 } }),
    ]);

    remapRemotePositions(state, insertAt(0, 4));

    expect(send).not.toHaveBeenCalled();
    expect(state.users.get("peer")?.cursor).toEqual({
      blockId: "body",
      offset: 6,
    });
  });
});
