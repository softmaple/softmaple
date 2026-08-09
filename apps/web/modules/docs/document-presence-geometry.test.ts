import type { PresenceUser } from "@softmaple/awareness";
import type {
  LexicalBinding,
  LogicalSelection,
  ResolveSelectionResult,
} from "@softmaple/binding-lexical";
import {
  BOOTSTRAP_BLOCK_ID,
  InvalidSequenceAtomError,
  UnknownSequenceAtomError,
} from "@softmaple/block-model";
import { describe, expect, it, vi } from "vitest";
import {
  isIsolatablePresenceAnchorError,
  mapPresenceUsers,
  resolveRemotePresenceSelection,
} from "./document-presence-geometry";

const baseUser = (
  connectionId: string,
  overrides: Partial<PresenceUser> = {},
): PresenceUser => ({
  connectionId,
  userId: connectionId,
  name: connectionId,
  color: "#c9184a",
  status: "active",
  lastActivityAt: 1,
  lastSeenAt: 1,
  clock: 0,
  ...overrides,
});

const cursorAt = (eventId: string): PresenceUser["cursor"] => ({
  blockId: BOOTSTRAP_BLOCK_ID,
  anchor: {
    type: "atom",
    eventId,
    offset: 0,
    affinity: "after",
  },
});

describe("resolveRemotePresenceSelection", () => {
  it("returns null while the remote atom is temporarily unresolved", () => {
    let historyAvailable = false;
    const logical: LogicalSelection = {
      anchor: { blockId: BOOTSTRAP_BLOCK_ID, offset: 3 },
      focus: { blockId: BOOTSTRAP_BLOCK_ID, offset: 3 },
    };
    const tryResolveSelection = vi.fn(
      (): ResolveSelectionResult =>
        historyAvailable
          ? { status: "resolved", selection: logical }
          : { status: "temporarily-unresolved" },
    );
    const binding = { tryResolveSelection } as Pick<
      LexicalBinding,
      "tryResolveSelection"
    >;
    const peer = baseUser("peer-a", { cursor: cursorAt("alice:1") });

    expect(resolveRemotePresenceSelection(binding, peer)).toBeNull();
    historyAvailable = true;
    expect(resolveRemotePresenceSelection(binding, peer)).toEqual(logical);
    expect(tryResolveSelection).toHaveBeenCalledTimes(2);
  });

  it("resolves already-integrated anchors", () => {
    const logical: LogicalSelection = {
      anchor: { blockId: BOOTSTRAP_BLOCK_ID, offset: 2 },
      focus: { blockId: BOOTSTRAP_BLOCK_ID, offset: 2 },
    };
    const binding = {
      tryResolveSelection: () =>
        ({
          status: "resolved",
          selection: logical,
        }) satisfies ResolveSelectionResult,
    };

    expect(
      resolveRemotePresenceSelection(
        binding,
        baseUser("peer-b", { cursor: cursorAt("alice:0") }),
      ),
    ).toEqual(logical);
  });
});

describe("mapPresenceUsers", () => {
  it("does not let one invalid peer block other remote carets", () => {
    const users = [baseUser("bad"), baseUser("good")];
    const mapped = mapPresenceUsers(users, (user) => {
      if (user.connectionId === "bad") {
        throw new InvalidSequenceAtomError("alice:0", 99);
      }
      return user.connectionId;
    });

    expect(mapped).toEqual(["good"]);
    expect(
      isIsolatablePresenceAnchorError(new InvalidSequenceAtomError("a", 0)),
    ).toBe(true);
    expect(
      isIsolatablePresenceAnchorError(new UnknownSequenceAtomError("a", 0)),
    ).toBe(true);
  });

  it("still propagates unexpected errors", () => {
    expect(() =>
      mapPresenceUsers([baseUser("boom")], () => {
        throw new TypeError("unexpected");
      }),
    ).toThrow(TypeError);
  });
});
