import { describe, expect, it } from "vitest";
import { createInitialState } from "../adapter-state";
import {
  createMessage,
  parseMessage,
  processMessage,
  serializeMessage,
} from "./message";
import { WS_MESSAGE } from "./types";
import {
  isErrorPayload,
  isJoinPayload,
  isLeavePayload,
  isPresenceSyncPayload,
  isPresenceUpdatePayload,
} from "./validation";

const validUser = () =>
  ({
    userId: "u-1",
    name: "Ada",
    color: "#2563eb",
    status: "active" as const,
    lastActiveAt: 1700000000000,
  }) satisfies Record<string, unknown>;

describe("websocket validation", () => {
  describe("isJoinPayload", () => {
    it("accepts a fully-formed PresenceUser", () => {
      expect(isJoinPayload({ user: validUser() })).toBe(true);
    });

    it("rejects null and primitives", () => {
      expect(isJoinPayload(null)).toBe(false);
      expect(isJoinPayload(undefined)).toBe(false);
      expect(isJoinPayload("oops")).toBe(false);
      expect(isJoinPayload([])).toBe(false);
    });

    it("rejects payloads missing a user", () => {
      expect(isJoinPayload({})).toBe(false);
      expect(isJoinPayload({ user: null })).toBe(false);
    });

    it("rejects users missing required fields", () => {
      expect(isJoinPayload({ user: { userId: "x" } })).toBe(false);
      expect(isJoinPayload({ user: { ...validUser(), name: 42 } })).toBe(false);
      expect(isJoinPayload({ user: { ...validUser(), status: "weird" } })).toBe(
        false,
      );
    });

    it("rejects users with malformed optional fields", () => {
      expect(
        isJoinPayload({ user: { ...validUser(), cursor: { blockId: "b" } } }),
      ).toBe(false);
      expect(
        isJoinPayload({
          user: { ...validUser(), selection: { blockId: "b", from: 0 } },
        }),
      ).toBe(false);
      expect(isJoinPayload({ user: { ...validUser(), meta: "no" } })).toBe(
        false,
      );
    });
  });

  describe("isLeavePayload", () => {
    it("accepts a userId string", () => {
      expect(isLeavePayload({ userId: "u-1" })).toBe(true);
    });

    it("rejects non-string userId", () => {
      expect(isLeavePayload({ userId: 123 })).toBe(false);
      expect(isLeavePayload({})).toBe(false);
    });
  });

  describe("isPresenceUpdatePayload", () => {
    it("accepts a minimal valid update", () => {
      expect(isPresenceUpdatePayload({ userId: "u-1", updates: {} })).toBe(
        true,
      );
    });

    it("accepts null cursor / selection (explicit clear on wire)", () => {
      expect(
        isPresenceUpdatePayload({
          userId: "u-1",
          updates: { cursor: null, selection: null },
        }),
      ).toBe(true);
    });

    it("accepts directional cross-block selection anchors", () => {
      expect(
        isPresenceUpdatePayload({
          userId: "u-1",
          updates: {
            selection: {
              anchor: {
                blockId: "b2",
                anchor: {
                  type: "atom",
                  eventId: "peer:4",
                  offset: 2,
                  affinity: "after",
                },
              },
              focus: {
                blockId: "b1",
                anchor: {
                  type: "boundary",
                  edge: "start",
                  affinity: "after",
                },
              },
            },
          },
        }),
      ).toBe(true);
    });

    it("rejects malformed cursor / selection shapes", () => {
      expect(
        isPresenceUpdatePayload({
          userId: "u-1",
          updates: { cursor: { blockId: "b" } },
        }),
      ).toBe(false);
      expect(
        isPresenceUpdatePayload({
          userId: "u-1",
          updates: { selection: { blockId: "b", from: "0", to: 1 } },
        }),
      ).toBe(false);
    });

    it("rejects when updates is not an object", () => {
      expect(isPresenceUpdatePayload({ userId: "u-1", updates: "no" })).toBe(
        false,
      );
    });

    it("rejects bad status / name / color types", () => {
      expect(
        isPresenceUpdatePayload({ userId: "u-1", updates: { name: 42 } }),
      ).toBe(false);
      expect(
        isPresenceUpdatePayload({ userId: "u-1", updates: { status: "x" } }),
      ).toBe(false);
      expect(
        isPresenceUpdatePayload({ userId: "u-1", updates: { color: 5 } }),
      ).toBe(false);
    });
  });

  describe("isPresenceSyncPayload", () => {
    it("accepts an empty user list", () => {
      expect(isPresenceSyncPayload({ users: [] })).toBe(true);
    });

    it("rejects when any user is malformed", () => {
      expect(
        isPresenceSyncPayload({ users: [validUser(), { userId: "x" }] }),
      ).toBe(false);
    });
  });

  describe("isErrorPayload", () => {
    it("requires code and message strings", () => {
      expect(isErrorPayload({ code: "A", message: "B" })).toBe(true);
      expect(isErrorPayload({ code: "A" })).toBe(false);
      expect(isErrorPayload({ code: 1, message: "B" })).toBe(false);
    });
  });
});

describe("processMessage rejects malformed payloads with notifyError", () => {
  const selfId = "self";
  const cases: Array<{
    label: string;
    type: (typeof WS_MESSAGE)[keyof typeof WS_MESSAGE];
    payload: unknown;
    errorContains: string;
  }> = [
    {
      label: "JOIN without user",
      type: WS_MESSAGE.JOIN,
      payload: { user: { userId: "x" } },
      errorContains: "JOIN",
    },
    {
      label: "LEAVE with numeric userId",
      type: WS_MESSAGE.LEAVE,
      payload: { userId: 123 },
      errorContains: "LEAVE",
    },
    {
      label: "PRESENCE_UPDATE with malformed cursor",
      type: WS_MESSAGE.PRESENCE_UPDATE,
      payload: { userId: "u", updates: { cursor: { blockId: "b" } } },
      errorContains: "PRESENCE_UPDATE",
    },
    {
      label: "PRESENCE_SYNC with bad users array",
      type: WS_MESSAGE.PRESENCE_SYNC,
      payload: { users: [{ userId: "x" }] },
      errorContains: "PRESENCE_SYNC",
    },
    {
      label: "ERROR with non-string code",
      type: WS_MESSAGE.ERROR,
      payload: { code: 500, message: "boom" },
      errorContains: "ERROR",
    },
  ];

  for (const { label, type, payload, errorContains } of cases) {
    it(`rejects ${label}`, () => {
      const state = createInitialState();
      const message = createMessage(type, "room-1", "peer", payload);
      const result = processMessage(state, message, selfId);

      expect(result.shouldNotifyPresence).toBe(false);
      expect(result.state).toBe(state);
      expect(result.error?.message).toContain(errorContains);
    });
  }
});

describe("WebSocket clear-cursor wire semantics", () => {
  it("serializes cursor: undefined as cursor: null so JSON preserves the clear signal", () => {
    const message = createMessage(WS_MESSAGE.PRESENCE_UPDATE, "room-1", "u-1", {
      userId: "u-1",
      updates: { cursor: undefined },
    });

    const wire = serializeMessage(message);

    expect(wire).toContain('"cursor":null');
    expect(JSON.parse(wire).payload.updates.cursor).toBeNull();
  });

  it("serializes selection: undefined as selection: null", () => {
    const message = createMessage(WS_MESSAGE.PRESENCE_UPDATE, "room-1", "u-1", {
      userId: "u-1",
      updates: { selection: undefined },
    });

    const wire = serializeMessage(message);
    expect(JSON.parse(wire).payload.updates.selection).toBeNull();
  });

  it("leaves untouched updates that don't reference cursor / selection", () => {
    const message = createMessage(WS_MESSAGE.PRESENCE_UPDATE, "room-1", "u-1", {
      userId: "u-1",
      updates: { meta: { isTyping: true } },
    });

    const wire = serializeMessage(message);
    const parsed = JSON.parse(wire);
    expect(parsed.payload.updates).toEqual({ meta: { isTyping: true } });
  });

  it("round-trip: send cursor=undefined, peer receives clear and existing user.cursor becomes undefined", () => {
    let state = createInitialState();
    // Seed with a peer that currently has a cursor.
    const peer = {
      userId: "peer",
      name: "Peer",
      color: "#000",
      status: "active" as const,
      lastActiveAt: 1,
      cursor: { blockId: "b", offset: 3 },
    };
    state = { ...state, presence: new Map([[peer.userId, peer]]) };

    // Sender emits a "clear cursor" update.
    const message = createMessage(
      WS_MESSAGE.PRESENCE_UPDATE,
      "room-1",
      "peer",
      { userId: "peer", updates: { cursor: undefined } },
    );
    const wire = serializeMessage(message);
    const parsed = parseMessage(wire);
    if (parsed === null) {
      throw new Error("parseMessage returned null");
    }

    const result = processMessage(state, parsed, "self");
    expect(result.shouldNotifyPresence).toBe(true);
    expect(result.state.presence.get("peer")?.cursor).toBeUndefined();
  });
});
