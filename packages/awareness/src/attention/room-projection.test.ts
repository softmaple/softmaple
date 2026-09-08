import { describe, expect, it } from "vitest";
import {
  ATTENTION_META_KEY,
  attentionMeta,
  roomAttentionCommand,
  roomMemberAttention,
} from "./room-projection";
import { ATTENTION_COMMAND, DEFAULT_ATTENTION_STATE } from "./types";

const cursor = {
  blockId: "b1",
  anchor: { type: "boundary", edge: "start", affinity: "after" },
};

const invitation = {
  anchor: { cursor, location: null },
  expiresAt: 1_030_000,
  id: "inv-1",
  issuedAt: 1_000_000,
  recipientSessionIds: ["them", "them-other-tab"],
  senderName: "Lina",
  senderSessionId: "lina-tab",
  senderUserId: "lina",
};

const envelope = { id: "cmd-1", issuedAt: 1_000_000 };

describe("roomAttentionCommand", () => {
  it("addresses an invitation to its recipients and carries its expiry", () => {
    const command = roomAttentionCommand({
      ...envelope,
      type: ATTENTION_COMMAND.Invite,
      invitation,
    });
    expect(command).toEqual({
      expiresAt: 1_030_000,
      id: "cmd-1",
      recipientSessionIds: ["them", "them-other-tab"],
      requiresPresenter: false,
      senderSessionId: "lina-tab",
      targetSessionId: null,
    });
  });

  it("addresses an answer back to whoever asked", () => {
    for (const type of [
      ATTENTION_COMMAND.Accept,
      ATTENTION_COMMAND.Dismiss,
    ] as const) {
      const command = roomAttentionCommand({
        ...envelope,
        type,
        invitationId: "inv-1",
        recipientSessionId: "them",
      });
      expect(command.recipientSessionIds).toEqual(["them"]);
      expect(command.requiresPresenter).toBe(false);
    }
  });

  it("makes a follow request require the presenter's opt-in", () => {
    const command = roomAttentionCommand({
      ...envelope,
      type: ATTENTION_COMMAND.FollowStart,
      followerSessionId: "me",
      presenterSessionId: "them",
    });
    expect(command.requiresPresenter).toBe(true);
    expect(command.targetSessionId).toBe("them");
    expect(command.senderSessionId).toBe("me");
  });

  it("never requires permission to stop following", () => {
    const command = roomAttentionCommand({
      ...envelope,
      type: ATTENTION_COMMAND.FollowStop,
      followerSessionId: "me",
      presenterSessionId: "them",
    });
    expect(command.requiresPresenter).toBe(false);
    expect(command.targetSessionId).toBeNull();
  });

  it("gives a non-expiring command a null expiry rather than a guess", () => {
    expect(
      roomAttentionCommand({
        ...envelope,
        type: ATTENTION_COMMAND.Cancel,
        invitationId: "inv-1",
        senderSessionId: "lina-tab",
      }).expiresAt,
    ).toBeNull();
  });

  it("rejects a malformed command rather than routing it", () => {
    expect(() =>
      roomAttentionCommand({ ...envelope, type: "attention:unknown" }),
    ).toThrow(/unknown attention command type/);
  });
});

describe("roomMemberAttention", () => {
  it("reads state a client published", () => {
    const member = {
      meta: attentionMeta(
        {
          ...DEFAULT_ATTENTION_STATE,
          followingSessionId: "them",
          presenting: true,
        },
        "my-tab",
      ),
    };
    expect(roomMemberAttention(member)).toEqual({
      followingSessionId: "them",
      presenting: true,
      sessionId: "my-tab",
    });
  });

  it("refuses on the safe side for anything missing or malformed", () => {
    const denied = {
      followingSessionId: null,
      presenting: false,
      sessionId: null,
    };
    expect(roomMemberAttention(undefined)).toEqual(denied);
    expect(roomMemberAttention({})).toEqual(denied);
    expect(roomMemberAttention({ meta: {} })).toEqual(denied);
    expect(
      roomMemberAttention({ meta: { [ATTENTION_META_KEY]: "yes" } }),
    ).toEqual(denied);
    // A truthy non-boolean must not read as consent to be followed.
    expect(
      roomMemberAttention({
        meta: { [ATTENTION_META_KEY]: { presenting: "true" } },
      }).presenting,
    ).toBe(false);
  });
});
