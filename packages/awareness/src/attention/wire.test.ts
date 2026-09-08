import { describe, expect, it } from "vitest";
import { ATTENTION_COMMAND, FOREGROUND, SESSION_ACTIVITY } from "./types";
import {
  parseAttentionCommand,
  parseAttentionInvitation,
  parseAttentionState,
  parseSemanticLocation,
} from "./wire";

const cursor = {
  blockId: "b1",
  anchor: { type: "boundary", edge: "start", affinity: "after" },
};

const location = { sectionId: "h1", sectionIndex: 1, title: "Method" };

const invitation = {
  anchor: { cursor, location },
  expiresAt: 1_030_000,
  id: "inv-1",
  issuedAt: 1_000_000,
  recipientSessionIds: ["them"],
  senderName: "Lina",
  senderSessionId: "lina-tab",
  senderUserId: "lina",
};

describe("parseSemanticLocation", () => {
  it("accepts a section and the implicit opening section", () => {
    expect(parseSemanticLocation(location)).toEqual(location);
    expect(
      parseSemanticLocation({ ...location, sectionId: null }).sectionId,
    ).toBeNull();
  });

  it("rejects a negative or non-integer index", () => {
    expect(() =>
      parseSemanticLocation({ ...location, sectionIndex: -1 }),
    ).toThrow(/non-negative integer/);
    expect(() =>
      parseSemanticLocation({ ...location, sectionIndex: 1.5 }),
    ).toThrow(/non-negative integer/);
  });

  it("truncates an over-long title rather than rejecting the frame", () => {
    expect(
      parseSemanticLocation({ ...location, title: "x".repeat(500) }).title,
    ).toHaveLength(200);
  });
});

describe("parseAttentionState", () => {
  it("accepts a complete state", () => {
    expect(
      parseAttentionState({
        activity: SESSION_ACTIVITY.Editing,
        followingSessionId: null,
        foreground: FOREGROUND.Foreground,
        location,
        presenting: true,
      }).presenting,
    ).toBe(true);
  });

  it("rejects unrecognised activity or foreground", () => {
    const base = {
      activity: SESSION_ACTIVITY.Viewing,
      followingSessionId: null,
      foreground: FOREGROUND.Foreground,
      location: null,
      presenting: false,
    };
    expect(() => parseAttentionState({ ...base, activity: "typing" })).toThrow(
      /activity is not recognised/,
    );
    expect(() => parseAttentionState({ ...base, foreground: "away" })).toThrow(
      /foreground is not recognised/,
    );
  });

  it("requires presenting to be an explicit boolean", () => {
    expect(() =>
      parseAttentionState({
        activity: SESSION_ACTIVITY.Viewing,
        followingSessionId: null,
        foreground: FOREGROUND.Foreground,
        location: null,
      }),
    ).toThrow(/presenting must be a boolean/);
  });
});

describe("parseAttentionInvitation", () => {
  it("accepts a well-formed invitation", () => {
    expect(parseAttentionInvitation(invitation).id).toBe("inv-1");
  });

  it("refuses one addressed to nobody, or to a crowd", () => {
    expect(() =>
      parseAttentionInvitation({ ...invitation, recipientSessionIds: [] }),
    ).toThrow(/between 1 and 50 recipients/);
    expect(() =>
      parseAttentionInvitation({
        ...invitation,
        recipientSessionIds: Array.from({ length: 51 }, (_u, i) => `s${i}`),
      }),
    ).toThrow(/between 1 and 50 recipients/);
  });

  it("refuses an invitation that expires before it was issued", () => {
    expect(() =>
      parseAttentionInvitation({ ...invitation, expiresAt: 999_999 }),
    ).toThrow(/expire after it was issued/);
  });

  it("refuses an anchor without a resolvable cursor", () => {
    expect(() =>
      parseAttentionInvitation({
        ...invitation,
        anchor: { cursor: { blockId: "b1" }, location },
      }),
    ).toThrow(/stable cursor position/);
  });

  it("truncates a long note instead of trusting its length", () => {
    expect(
      parseAttentionInvitation({ ...invitation, note: "y".repeat(400) }).note,
    ).toHaveLength(140);
  });
});

describe("parseAttentionCommand", () => {
  const envelope = { id: "cmd-1", issuedAt: 1_000_000 };

  it("parses every command type", () => {
    expect(
      parseAttentionCommand({
        ...envelope,
        type: ATTENTION_COMMAND.Invite,
        invitation,
      }).type,
    ).toBe(ATTENTION_COMMAND.Invite);

    expect(
      parseAttentionCommand({
        ...envelope,
        type: ATTENTION_COMMAND.Accept,
        invitationId: "inv-1",
        recipientSessionId: "them",
      }).type,
    ).toBe(ATTENTION_COMMAND.Accept);

    expect(
      parseAttentionCommand({
        ...envelope,
        type: ATTENTION_COMMAND.FollowStart,
        followerSessionId: "me",
        presenterSessionId: "them",
      }).type,
    ).toBe(ATTENTION_COMMAND.FollowStart);
  });

  it("requires an id, so a duplicate can always be detected", () => {
    expect(() =>
      parseAttentionCommand({
        issuedAt: 1,
        type: ATTENTION_COMMAND.Cancel,
        invitationId: "inv-1",
        senderSessionId: "lina-tab",
      }),
    ).toThrow(/command.id/);
  });

  it("refuses a command type it does not know", () => {
    expect(() =>
      parseAttentionCommand({ ...envelope, type: "attention:mind-control" }),
    ).toThrow(/unknown attention command type/);
  });

  it("refuses a follow command missing a target", () => {
    expect(() =>
      parseAttentionCommand({
        ...envelope,
        type: ATTENTION_COMMAND.FollowStart,
        followerSessionId: "me",
      }),
    ).toThrow(/presenterSessionId must be a session id/);
  });
});
