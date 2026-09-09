import { describe, expect, it } from "vitest";
import { createPresenceUser } from "../types/presence";
import {
  type AttentionMember,
  applyAttentionCommand,
  emptyCollaborationState,
  filterAttentionFrame,
  parseAttentionCommand,
  visibleAttentionMember,
} from "./attention";

const person = (id: string): AttentionMember => ({
  ...createPresenceUser({
    userId: id,
    name: id,
    connectionId: `connection-${id}`,
    color: "#175bb5",
  }),
  sessionId: id,
  collaboration: emptyCollaborationState(),
});
const anchor = {
  anchor: {
    blockId: "passage",
    anchor: { type: "boundary", edge: "start", affinity: "after" },
  },
  focus: {
    blockId: "passage",
    anchor: { type: "boundary", edge: "start", affinity: "after" },
  },
} as const;
const invitation = {
  id: "invitation",
  action: { type: "invite", anchor, recipients: ["reader"] },
} as const;

describe("shared attention contracts", () => {
  it("addresses a bounded invitation without changing cursor clocks", () => {
    const sender = person("sender");
    const updated = applyAttentionCommand(
      sender,
      [person("reader")],
      invitation,
      10_000,
    );
    expect(updated.collaboration?.invitation?.expiresAt).toBe(40_000);
    expect(updated.clock).toBe(sender.clock);
    expect(updated.cursor).toBe(sender.cursor);
    expect(
      visibleAttentionMember(updated, {
        sharedAttention: 1,
        sessionId: "bystander",
      }).collaboration?.invitation,
    ).toBeNull();
    expect(
      visibleAttentionMember(updated, {
        sharedAttention: 1,
        sessionId: "reader",
      }).collaboration?.invitation?.id,
    ).toBe("invitation");
  });
  it("deduplicates a retry without extending expiry or increasing revision", () => {
    const sender = applyAttentionCommand(
      person("sender"),
      [person("reader")],
      invitation,
      10_000,
    );
    expect(
      applyAttentionCommand(sender, [person("reader")], invitation, 12_000),
    ).toBe(sender);
  });
  it("rejects absent recipients and expired acceptance", () => {
    expect(() =>
      applyAttentionCommand(person("sender"), [], invitation, 10_000),
    ).toThrow("no longer available");
    const sender = applyAttentionCommand(
      person("sender"),
      [person("reader")],
      invitation,
      10_000,
    );
    expect(() =>
      applyAttentionCommand(
        person("reader"),
        [sender],
        {
          id: "response",
          action: {
            type: "respond",
            senderSessionId: "sender",
            invitationId: "invitation",
            outcome: "accepted",
          },
        },
        40_000,
      ),
    ).toThrow("expired");
  });
  it("cancels an invitation and denies subsequent acceptance", () => {
    const sender = applyAttentionCommand(
      person("sender"),
      [person("reader")],
      invitation,
      10_000,
    );
    const cancelled = applyAttentionCommand(
      sender,
      [],
      { id: "cancel", action: { type: "cancel", invitationId: "invitation" } },
      11_000,
    );
    expect(cancelled.collaboration?.invitation).toBeNull();
    expect(() =>
      applyAttentionCommand(
        person("reader"),
        [cancelled],
        {
          id: "response",
          action: {
            type: "respond",
            senderSessionId: "sender",
            invitationId: "invitation",
            outcome: "accepted",
          },
        },
        12_000,
      ),
    ).toThrow();
  });
  it("requires presenter opt-in and prevents follow cycles", () => {
    const viewer = person("reader");
    expect(() =>
      applyAttentionCommand(
        viewer,
        [person("sender")],
        { id: "follow", action: { type: "follow", sessionId: "sender" } },
        10_000,
      ),
    ).toThrow("not presenting");
    const sender = applyAttentionCommand(
      person("sender"),
      [],
      { id: "present", action: { type: "present", enabled: true } },
      10_000,
    );
    const following = applyAttentionCommand(
      viewer,
      [sender],
      { id: "follow", action: { type: "follow", sessionId: "sender" } },
      10_000,
    );
    expect(following.collaboration?.following?.connectionId).toBe(
      sender.connectionId,
    );
    expect(() =>
      applyAttentionCommand(
        following,
        [sender],
        { id: "present", action: { type: "present", enabled: true } },
        11_000,
      ),
    ).toThrow("Stop following");
    const suspended = applyAttentionCommand(
      following,
      [sender],
      { id: "suspend", action: { type: "suspend" } },
      12_000,
    );
    expect(suspended.collaboration?.following?.status).toBe("suspended");
    expect(() =>
      applyAttentionCommand(
        suspended,
        [],
        { id: "resume", action: { type: "resume" } },
        13_000,
      ),
    ).toThrow("unavailable");
  });
  it("strips extensions and server receipts for old clients", () => {
    const sender = applyAttentionCommand(
      person("sender"),
      [person("reader")],
      invitation,
      10_000,
    );
    const basic = visibleAttentionMember(sender, undefined);
    expect(basic).not.toHaveProperty("collaboration");
    expect(basic).not.toHaveProperty("sessionId");
    expect(basic).not.toHaveProperty("attentionReceipts");
    expect(
      filterAttentionFrame(
        { type: "attention:state", payload: { member: sender } },
        undefined,
      ),
    ).toBeNull();
  });
  it("rejects malformed anchors and unbounded audiences", () => {
    expect(() =>
      parseAttentionCommand({
        id: "x",
        action: { type: "invite", recipients: ["reader"], anchor: {} },
      }),
    ).toThrow();
    expect(() =>
      parseAttentionCommand({
        id: "x",
        action: {
          type: "invite",
          recipients: Array(101).fill("reader"),
          anchor,
        },
      }),
    ).toThrow();
  });
});
