import { describe, expect, it } from "vitest";
import {
  applyPresencePatch,
  createPresenceMember,
  isPresenceUser,
} from "./member";
import type { PresencePatch } from "./patch";

const BASE_PATCH: PresencePatch = {
  clock: 1,
  connectionId: "connection-1",
  hasCursor: false,
  hasSelection: false,
  userId: "user-1",
};

describe("isPresenceUser", () => {
  it("accepts a well-formed PresenceUser", () => {
    const user = createPresenceMember(
      { name: "Ada", userId: "user-1" },
      "connection-1",
      0,
    );
    expect(isPresenceUser(user)).toBe(true);
  });

  it.each([
    ["a non-object", "nope"],
    [
      "a missing connectionId",
      {
        userId: "u",
        name: "n",
        color: "c",
        status: "active",
        lastActivityAt: 1,
        lastSeenAt: 1,
        clock: 0,
      },
    ],
    [
      "a missing name",
      {
        connectionId: "c",
        userId: "u",
        color: "c",
        status: "active",
        lastActivityAt: 1,
        lastSeenAt: 1,
        clock: 0,
      },
    ],
    [
      "an invalid status",
      {
        connectionId: "c",
        userId: "u",
        name: "n",
        color: "c",
        status: "gone",
        lastActivityAt: 1,
        lastSeenAt: 1,
        clock: 0,
      },
    ],
    [
      "a non-finite lastActivityAt",
      {
        connectionId: "c",
        userId: "u",
        name: "n",
        color: "c",
        status: "active",
        lastActivityAt: Number.NaN,
        lastSeenAt: 1,
        clock: 0,
      },
    ],
    [
      "a non-numeric clock",
      {
        connectionId: "c",
        userId: "u",
        name: "n",
        color: "c",
        status: "active",
        lastActivityAt: 1,
        lastSeenAt: 1,
        clock: "0",
      },
    ],
  ])("rejects %s", (_case, value) => {
    expect(isPresenceUser(value)).toBe(false);
  });
});

describe("createPresenceMember", () => {
  it("builds a fresh member with clock 0 and a deterministic color", () => {
    const member = createPresenceMember(
      { name: "Ada Lovelace", userId: "user-1" },
      "connection-1",
      1_000,
    );
    expect(member).toMatchObject({
      connectionId: "connection-1",
      userId: "user-1",
      name: "Ada Lovelace",
      status: "active",
      lastActivityAt: 1_000,
      lastSeenAt: 1_000,
      clock: 0,
    });
    expect(member).not.toHaveProperty("avatarUrl");
  });

  it("carries an avatarUrl only when provided", () => {
    const member = createPresenceMember(
      { name: "Ada", userId: "user-1", avatarUrl: "https://example.com/a.png" },
      "connection-1",
      0,
    );
    expect(member.avatarUrl).toBe("https://example.com/a.png");
  });
});

describe("applyPresencePatch", () => {
  const current = createPresenceMember(
    { name: "Ada", userId: "user-1" },
    "connection-1",
    0,
  );

  it("sets cursor/selection when present and bumps clock/liveness", () => {
    const { member, updates } = applyPresencePatch(
      current,
      {
        ...BASE_PATCH,
        cursor: { blockId: "b1", offset: 3 },
        hasCursor: true,
        clock: 5,
      },
      2_000,
    );
    expect(member.cursor).toEqual({ blockId: "b1", offset: 3 });
    expect(member.clock).toBe(5);
    expect(member.lastActivityAt).toBe(2_000);
    expect(member.lastSeenAt).toBe(2_000);
    expect(member.status).toBe("active");
    expect(updates).toMatchObject({
      cursor: { blockId: "b1", offset: 3 },
      lastActivityAt: 2_000,
      lastSeenAt: 2_000,
      status: "active",
    });
  });

  it("removes cursor/selection on an explicit null clear", () => {
    const withCursor = applyPresencePatch(
      current,
      {
        ...BASE_PATCH,
        cursor: { blockId: "b1", offset: 1 },
        hasCursor: true,
        clock: 2,
      },
      1_000,
    ).member;
    const { member, updates } = applyPresencePatch(
      withCursor,
      { ...BASE_PATCH, cursor: null, hasCursor: true, clock: 3 },
      1_100,
    );
    expect(member).not.toHaveProperty("cursor");
    expect(updates.cursor).toBeNull();
  });

  it("sets meta.isTyping on both the member and the published updates", () => {
    const { member, updates } = applyPresencePatch(
      current,
      { ...BASE_PATCH, isTyping: true, clock: 4 },
      1_000,
    );
    expect(member.meta).toEqual({ isTyping: true });
    expect(updates.meta).toEqual({ isTyping: true });
  });

  it("leaves fields untouched when the patch does not mention them", () => {
    const withCursor = applyPresencePatch(
      current,
      {
        ...BASE_PATCH,
        cursor: { blockId: "b1", offset: 1 },
        hasCursor: true,
        clock: 2,
      },
      1_000,
    ).member;
    const { member, updates } = applyPresencePatch(
      withCursor,
      { ...BASE_PATCH, clock: 3 },
      1_100,
    );
    expect(member.cursor).toEqual({ blockId: "b1", offset: 1 });
    expect(updates).not.toHaveProperty("cursor");
  });
});
