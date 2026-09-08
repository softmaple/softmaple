import { describe, expect, it } from "vitest";
import {
  answerInvitation,
  createInvitation,
  delivered,
  EMPTY_REGISTRY,
  expireInvitations,
  receiveInvitation,
  refused,
  removeInvitation,
  SEEN_COMMAND_LIMIT,
  visibleInvitation,
} from "./invitations";
import {
  ATTENTION_INVITATION_TTL_MS,
  ATTENTION_REFUSAL,
  type AttentionAnchor,
} from "./types";

const NOW = 1_000_000;

const anchor: AttentionAnchor = {
  cursor: {
    blockId: "b1",
    anchor: { type: "boundary", edge: "start", affinity: "after" },
  },
  location: { sectionId: "h1", sectionIndex: 1, title: "Method" },
};

const invitationFor = (
  id: string,
  recipients: ReadonlyArray<string> = ["me"],
  now = NOW,
) =>
  createInvitation({
    anchor,
    id,
    now,
    recipientSessionIds: recipients,
    senderName: "Lina",
    senderSessionId: "lina-tab",
    senderUserId: "lina",
  });

const receive = (
  commandId: string,
  invitation = invitationFor("inv-1"),
  now = NOW,
  registry = EMPTY_REGISTRY,
) =>
  receiveInvitation({
    commandId,
    invitation,
    now,
    registry,
    sessionId: "me",
  });

describe("createInvitation", () => {
  it("expires 30 seconds after it was issued", () => {
    const invitation = invitationFor("inv-1");
    expect(invitation.expiresAt - invitation.issuedAt).toBe(
      ATTENTION_INVITATION_TTL_MS,
    );
  });

  it("refuses an invitation addressed to nobody", () => {
    expect(() => invitationFor("inv-1", [])).toThrow(/at least one recipient/);
  });
});

describe("receiveInvitation", () => {
  it("accepts one addressed to this session", () => {
    const result = receive("cmd-1");
    expect(result.accepted).toBe(true);
    if (!result.accepted) return;
    expect(result.registry.invitations).toHaveLength(1);
  });

  it("refuses a duplicate command id", () => {
    const first = receive("cmd-1");
    expect(first.accepted).toBe(true);
    if (!first.accepted) return;
    const second = receive(
      "cmd-1",
      invitationFor("inv-1"),
      NOW,
      first.registry,
    );
    expect(second).toEqual({
      accepted: false,
      reason: ATTENTION_REFUSAL.Duplicate,
    });
  });

  it("refuses one addressed to somebody else", () => {
    expect(receive("cmd-1", invitationFor("inv-1", ["someone"]))).toEqual({
      accepted: false,
      reason: ATTENTION_REFUSAL.NotAddressed,
    });
  });

  it("refuses one that already expired, so a reconnect cannot replay it", () => {
    const stale = invitationFor("inv-1", ["me"], NOW - 60_000);
    expect(receive("cmd-1", stale)).toEqual({
      accepted: false,
      reason: ATTENTION_REFUSAL.Expired,
    });
  });

  it("replaces rather than duplicates when the same invitation is resent", () => {
    const first = receive("cmd-1");
    expect(first.accepted).toBe(true);
    if (!first.accepted) return;
    const second = receive(
      "cmd-2",
      invitationFor("inv-1"),
      NOW,
      first.registry,
    );
    expect(second.accepted).toBe(true);
    if (!second.accepted) return;
    expect(second.registry.invitations).toHaveLength(1);
  });

  it("bounds the ids it remembers", () => {
    let registry = EMPTY_REGISTRY;
    for (let index = 0; index < SEEN_COMMAND_LIMIT + 20; index += 1) {
      const result = receive(
        `cmd-${index}`,
        invitationFor(`inv-${index}`),
        NOW,
        registry,
      );
      if (result.accepted) registry = result.registry;
    }
    expect(registry.seenCommandIds.size).toBeLessThanOrEqual(
      SEEN_COMMAND_LIMIT,
    );
  });
});

describe("expiry", () => {
  it("drops invitations once their time is up", () => {
    const received = receive("cmd-1");
    expect(received.accepted).toBe(true);
    if (!received.accepted) return;
    expect(
      expireInvitations(received.registry, NOW + ATTENTION_INVITATION_TTL_MS)
        .invitations,
    ).toHaveLength(0);
  });

  it("returns the same registry when nothing expired", () => {
    const received = receive("cmd-1");
    expect(received.accepted).toBe(true);
    if (!received.accepted) return;
    expect(expireInvitations(received.registry, NOW + 1)).toBe(
      received.registry,
    );
  });
});

describe("visibleInvitation", () => {
  it("surfaces only the newest, so a queue of interruptions cannot form", () => {
    let registry = EMPTY_REGISTRY;
    for (const id of ["inv-1", "inv-2", "inv-3"]) {
      const result = receive(`cmd-${id}`, invitationFor(id), NOW, registry);
      if (result.accepted) registry = result.registry;
    }
    expect(registry.invitations).toHaveLength(3);
    expect(visibleInvitation(registry, NOW)?.id).toBe("inv-3");
  });

  it("shows nothing once everything has expired", () => {
    const received = receive("cmd-1");
    expect(received.accepted).toBe(true);
    if (!received.accepted) return;
    expect(
      visibleInvitation(received.registry, NOW + ATTENTION_INVITATION_TTL_MS),
    ).toBeNull();
  });
});

describe("answerInvitation", () => {
  it("spends the invitation", () => {
    const received = receive("cmd-1");
    expect(received.accepted).toBe(true);
    if (!received.accepted) return;
    const answered = answerInvitation({
      invitationId: "inv-1",
      now: NOW,
      registry: received.registry,
    });
    expect(answered.answered).toBe(true);
    if (!answered.answered) return;
    expect(answered.registry.invitations).toHaveLength(0);
    expect(answered.invitation.id).toBe("inv-1");
  });

  it("distinguishes an expired invitation from one that never existed", () => {
    const received = receive("cmd-1");
    expect(received.accepted).toBe(true);
    if (!received.accepted) return;
    expect(
      answerInvitation({
        invitationId: "inv-1",
        now: NOW + ATTENTION_INVITATION_TTL_MS,
        registry: received.registry,
      }),
    ).toEqual({ answered: false, reason: ATTENTION_REFUSAL.Expired });
    expect(
      answerInvitation({
        invitationId: "never",
        now: NOW,
        registry: received.registry,
      }),
    ).toEqual({ answered: false, reason: ATTENTION_REFUSAL.Unknown });
  });
});

describe("removeInvitation", () => {
  it("is a no-op for an invitation that is not held", () => {
    expect(removeInvitation(EMPTY_REGISTRY, "nope")).toBe(EMPTY_REGISTRY);
  });
});

describe("outcomes", () => {
  it("always names who it reached, or why it did not", () => {
    expect(delivered("cmd-1", ["a", "b"])).toEqual({
      status: "delivered",
      commandId: "cmd-1",
      deliveredToSessionIds: ["a", "b"],
    });
    expect(refused("cmd-1", ATTENTION_REFUSAL.NotPresenting)).toEqual({
      status: "refused",
      commandId: "cmd-1",
      reason: ATTENTION_REFUSAL.NotPresenting,
    });
  });
});
