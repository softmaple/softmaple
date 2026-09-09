import { describe, expect, it } from "vitest";
import { createPresenceUser, type PresenceUser } from "../types/presence";
import {
  type AttentionMember,
  applyAttentionCommand,
  emptyCollaborationState,
  filterAttentionFrame,
  normalizeCollaborationState,
  parseAttentionCommand,
  parseAttentionContext,
  visibleAttentionMember,
} from "./attention";

const person = (id: string, status: PresenceUser["status"] = "active") => ({
  ...createPresenceUser({
    userId: id,
    name: id,
    connectionId: `connection-${id}`,
    color: "#175bb5",
    status,
  }),
  sessionId: id,
  collaboration: emptyCollaborationState(),
});

const boundary = {
  blockId: "passage",
  anchor: { type: "boundary", edge: "start", affinity: "after" },
} as const;
const anchor = { anchor: boundary, focus: boundary } as const;
const invite = (
  id = "invitation",
  recipients: readonly string[] = ["reader"],
) => ({ id, action: { type: "invite", anchor, recipients } }) as const;
const present = (id: string, enabled: boolean) =>
  ({ id, action: { type: "present", enabled } }) as const;
const context = { sharedAttention: 1, sessionId: "reader" } as const;

describe("attention context parsing", () => {
  it("accepts only a bounded session identifier with the capability", () => {
    expect(parseAttentionContext(context)).toEqual({
      sharedAttention: 1,
      sessionId: "reader",
    });
    expect(parseAttentionContext(null)).toBeUndefined();
    expect(parseAttentionContext([])).toBeUndefined();
    expect(
      parseAttentionContext({ sharedAttention: 2, sessionId: "reader" }),
    ).toBeUndefined();
    expect(parseAttentionContext({ sharedAttention: 1 })).toBeUndefined();
    expect(
      parseAttentionContext({ sharedAttention: 1, sessionId: "" }),
    ).toBeUndefined();
    expect(
      parseAttentionContext({ sharedAttention: 1, sessionId: "x".repeat(129) }),
    ).toBeUndefined();
  });
});

describe("attention command parsing", () => {
  it("rejects envelopes that are not an identified action", () => {
    expect(() => parseAttentionCommand(null)).toThrow("Invalid attention");
    expect(() => parseAttentionCommand([])).toThrow("Invalid attention");
    expect(() => parseAttentionCommand({ action: { type: "stop" } })).toThrow(
      "Invalid attention",
    );
    expect(() =>
      parseAttentionCommand({ id: "", action: { type: "stop" } }),
    ).toThrow("Invalid attention");
    expect(() => parseAttentionCommand({ id: "x", action: "stop" })).toThrow(
      "Invalid attention",
    );
    expect(() =>
      parseAttentionCommand({ id: "x", action: { type: "teleport" } }),
    ).toThrow("Unknown attention action.");
  });

  it("bounds an invitation audience and removes repeated recipients", () => {
    const parsed = parseAttentionCommand(
      invite("x", ["reader", "reader", "editor"]),
    );
    expect(parsed.action).toMatchObject({
      type: "invite",
      recipients: ["reader", "editor"],
    });
    expect(() => parseAttentionCommand(invite("x", []))).toThrow(
      "Choose a passage",
    );
    expect(() =>
      parseAttentionCommand({
        id: "x",
        action: { type: "invite", anchor, recipients: "reader" },
      }),
    ).toThrow("Choose a passage");
    expect(() => parseAttentionCommand(invite("x", [""]))).toThrow(
      "Choose a passage",
    );
  });

  it("validates responses, cancellations, presentation, and following", () => {
    const respond = (patch: Record<string, unknown>) => ({
      id: "x",
      action: {
        type: "respond",
        senderSessionId: "sender",
        invitationId: "invitation",
        outcome: "accepted",
        ...patch,
      },
    });
    expect(parseAttentionCommand(respond({})).action).toMatchObject({
      type: "respond",
      outcome: "accepted",
    });
    expect(() => parseAttentionCommand(respond({ outcome: "maybe" }))).toThrow(
      "Invalid invitation response.",
    );
    expect(() =>
      parseAttentionCommand(respond({ senderSessionId: 1 })),
    ).toThrow("Invalid invitation response.");
    expect(() => parseAttentionCommand(respond({ invitationId: "" }))).toThrow(
      "Invalid invitation response.",
    );

    expect(
      parseAttentionCommand({
        id: "x",
        action: { type: "cancel", invitationId: "invitation" },
      }).action,
    ).toEqual({ type: "cancel", invitationId: "invitation" });
    expect(() =>
      parseAttentionCommand({ id: "x", action: { type: "cancel" } }),
    ).toThrow("Invalid invitation.");

    expect(parseAttentionCommand(present("x", false)).action).toEqual({
      type: "present",
      enabled: false,
    });
    expect(() =>
      parseAttentionCommand({ id: "x", action: { type: "present" } }),
    ).toThrow("Invalid presentation state.");

    expect(
      parseAttentionCommand({
        id: "x",
        action: { type: "follow", sessionId: "sender" },
      }).action,
    ).toEqual({ type: "follow", sessionId: "sender" });
    expect(() =>
      parseAttentionCommand({ id: "x", action: { type: "follow" } }),
    ).toThrow("Choose a presenter.");

    for (const type of ["suspend", "resume", "stop"] as const)
      expect(
        parseAttentionCommand({ id: "x", action: { type } }).action,
      ).toEqual({ type });
  });
});

describe("attention transitions", () => {
  it("requires a session that negotiated shared attention", () => {
    const { sessionId: _sessionId, ...anonymous } = person("author");
    expect(() =>
      applyAttentionCommand(anonymous, [], present("x", true), 0),
    ).toThrow("Shared attention is unavailable");
    const { collaboration: _collaboration, ...legacy } = person("author");
    expect(() =>
      applyAttentionCommand(legacy, [], present("x", true), 0),
    ).toThrow("Shared attention is unavailable");
  });

  it("paces bursts and forgets receipts older than the dedup window", () => {
    let author: AttentionMember = person("author");
    for (let index = 0; index < 4; index += 1)
      author = applyAttentionCommand(
        author,
        [],
        present(`p${index}`, index % 2 === 0),
        1_000 + index,
      );
    expect(() =>
      applyAttentionCommand(author, [], present("p4", true), 1_004),
    ).toThrow("wait a moment");
    const later = applyAttentionCommand(author, [], present("p4", true), 3_000);
    expect(later.collaboration?.revision).toBe(5);
    const replayed = applyAttentionCommand(
      later,
      [],
      present("p0", true),
      40_000,
    );
    expect(replayed.collaboration?.revision).toBe(6);
  });

  it("records an addressed response and refuses an unaddressed one", () => {
    const sender = applyAttentionCommand(
      person("sender"),
      [person("reader")],
      invite(),
      10_000,
    );
    const accepted = applyAttentionCommand(
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
      11_000,
    );
    expect(accepted.collaboration?.response).toEqual({
      invitationId: "invitation",
      senderSessionId: "sender",
      outcome: "accepted",
      expiresAt: 40_000,
    });
    expect(() =>
      applyAttentionCommand(
        person("bystander"),
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
        11_000,
      ),
    ).toThrow("expired or is unavailable");
  });

  it("keeps invitations paced, addressed, and to people who are here", () => {
    const sender = applyAttentionCommand(
      person("sender"),
      [person("reader")],
      invite(),
      10_000,
    );
    expect(() =>
      applyAttentionCommand(
        sender,
        [person("reader")],
        invite("again"),
        12_000,
      ),
    ).toThrow("wait before inviting");
    expect(() =>
      applyAttentionCommand(
        person("sender"),
        [person("reader")],
        invite("self", ["sender"]),
        10_000,
      ),
    ).toThrow("no longer available");
    expect(() =>
      applyAttentionCommand(
        person("sender"),
        [person("reader", "offline")],
        invite(),
        10_000,
      ),
    ).toThrow("no longer available");
    const cancelled = applyAttentionCommand(
      sender,
      [],
      { id: "cancel", action: { type: "cancel", invitationId: "other" } },
      12_000,
    );
    expect(cancelled.collaboration?.invitation?.id).toBe("invitation");
    expect(cancelled.collaboration?.revision).toBe(2);
  });

  it("moves between presenting, following, suspending, and stopping", () => {
    const presenter = applyAttentionCommand(
      person("sender"),
      [],
      present("present", true),
      10_000,
    );
    expect(() =>
      applyAttentionCommand(
        presenter,
        [person("reader")],
        { id: "follow", action: { type: "follow", sessionId: "reader" } },
        11_000,
      ),
    ).toThrow("Stop presenting");
    expect(() =>
      applyAttentionCommand(
        person("sender"),
        [presenter],
        { id: "follow", action: { type: "follow", sessionId: "sender" } },
        11_000,
      ),
    ).toThrow("not presenting");

    const following = applyAttentionCommand(
      person("reader"),
      [presenter],
      { id: "follow", action: { type: "follow", sessionId: "sender" } },
      11_000,
    );
    expect(() =>
      applyAttentionCommand(
        person("third"),
        [following],
        { id: "follow", action: { type: "follow", sessionId: "reader" } },
        12_000,
      ),
    ).toThrow("not presenting");

    const quiet = applyAttentionCommand(
      following,
      [presenter],
      present("quiet", false),
      12_000,
    );
    expect(quiet.collaboration?.presenting).toBe(false);
    const suspended = applyAttentionCommand(
      quiet,
      [presenter],
      { id: "suspend", action: { type: "suspend" } },
      13_000,
    );
    const resumed = applyAttentionCommand(
      suspended,
      [presenter],
      { id: "resume", action: { type: "resume" } },
      14_000,
    );
    expect(resumed.collaboration?.following).toEqual({
      sessionId: "sender",
      connectionId: presenter.connectionId,
      status: "following",
    });
    const stopped = applyAttentionCommand(
      resumed,
      [presenter],
      { id: "stop", action: { type: "stop" } },
      15_000,
    );
    expect(stopped.collaboration?.following).toBeNull();
    const idle = applyAttentionCommand(
      stopped,
      [presenter],
      { id: "suspend", action: { type: "suspend" } },
      16_000,
    );
    expect(idle.collaboration?.following).toBeNull();
  });
});

describe("attention visibility", () => {
  it("returns a basic member whenever shared attention does not apply", () => {
    const reader = person("reader");
    expect(visibleAttentionMember(reader, context).collaboration).toEqual(
      emptyCollaborationState(),
    );
    const { collaboration: _collaboration, ...legacy } = reader;
    expect(visibleAttentionMember(legacy, context)).not.toHaveProperty(
      "collaboration",
    );
    expect(
      visibleAttentionMember(reader, { sharedAttention: 0 }),
    ).not.toHaveProperty("collaboration");
  });

  it("shows an invitation to its sender as well as its recipients", () => {
    const sender = applyAttentionCommand(
      person("sender"),
      [person("reader")],
      invite(),
      10_000,
    );
    expect(
      visibleAttentionMember(sender, {
        sharedAttention: 1,
        sessionId: "sender",
      }).collaboration?.invitation?.id,
    ).toBe("invitation");
  });
});

describe("collaboration state normalization", () => {
  const base = { ...emptyCollaborationState(), revision: 3 };

  it("accepts a well-formed state and rejects malformed envelopes", () => {
    expect(normalizeCollaborationState(base)).toEqual(base);
    expect(normalizeCollaborationState(null)).toBeNull();
    expect(normalizeCollaborationState({ ...base, revision: -1 })).toBeNull();
    expect(normalizeCollaborationState({ ...base, revision: 1.5 })).toBeNull();
    expect(
      normalizeCollaborationState({ ...base, presenting: "yes" }),
    ).toBeNull();
  });

  it("validates the follow relationship", () => {
    const following = {
      sessionId: "sender",
      connectionId: "connection-sender",
      status: "suspended",
    };
    expect(normalizeCollaborationState({ ...base, following })).toEqual({
      ...base,
      following,
    });
    for (const patch of [
      "sender",
      { ...following, sessionId: "" },
      { ...following, connectionId: 4 },
      { ...following, status: "watching" },
    ])
      expect(
        normalizeCollaborationState({ ...base, following: patch }),
      ).toBeNull();
  });

  it("validates the invitation and its anchor", () => {
    const invitation = {
      id: "invitation",
      anchor,
      recipients: ["reader"],
      createdAt: 10_000,
      expiresAt: 40_000,
    };
    expect(
      normalizeCollaborationState({ ...base, invitation })?.invitation,
    ).toMatchObject({ id: "invitation", recipients: ["reader"] });
    for (const patch of [
      "invitation",
      { ...invitation, id: "" },
      { ...invitation, createdAt: "10000" },
      { ...invitation, createdAt: Number.NaN },
      { ...invitation, expiresAt: "40000" },
      { ...invitation, expiresAt: Number.POSITIVE_INFINITY },
      { ...invitation, anchor: {} },
      { ...invitation, recipients: [] },
    ])
      expect(
        normalizeCollaborationState({ ...base, invitation: patch }),
      ).toBeNull();
  });

  it("validates the recorded response", () => {
    const response = {
      invitationId: "invitation",
      senderSessionId: "sender",
      outcome: "dismissed",
      expiresAt: 40_000,
    };
    expect(normalizeCollaborationState({ ...base, response })).toEqual({
      ...base,
      response,
    });
    for (const patch of [
      "response",
      { ...response, invitationId: "" },
      { ...response, senderSessionId: 7 },
      { ...response, outcome: "ignored" },
      { ...response, expiresAt: "40000" },
      { ...response, expiresAt: Number.NaN },
    ])
      expect(
        normalizeCollaborationState({ ...base, response: patch }),
      ).toBeNull();
  });
});

describe("attention frame filtering", () => {
  const sender = applyAttentionCommand(
    person("sender"),
    [person("reader")],
    invite(),
    10_000,
  );

  it("announces the extension only to sessions that negotiated it", () => {
    expect(filterAttentionFrame({ type: "auth_ok" }, context)).toEqual({
      type: "auth_ok",
      payload: { extensions: { sharedAttention: 1 } },
    });
    expect(filterAttentionFrame({ type: "auth_ok" }, undefined)).toEqual({
      type: "auth_ok",
      payload: {},
    });
  });

  it("passes through frames it does not own", () => {
    expect(filterAttentionFrame("ping", context)).toBe("ping");
    expect(filterAttentionFrame({ type: "leave" }, context)).toEqual({
      type: "leave",
    });
    expect(
      filterAttentionFrame({ type: "join", payload: {} }, context),
    ).toEqual({ type: "join", payload: {} });
  });

  it("withholds attention state from sessions without the extension", () => {
    expect(
      filterAttentionFrame({ type: "attention:state", payload: {} }, undefined),
    ).toBeNull();
    expect(
      filterAttentionFrame({ type: "attention:state", payload: 1 }, context),
    ).toBeNull();
    expect(
      filterAttentionFrame(
        { type: "attention:state", payload: { member: {} } },
        context,
      ),
    ).toBeNull();
  });

  it("reduces a rejection to the request it answers", () => {
    expect(
      filterAttentionFrame(
        {
          type: "attention:state",
          payload: {
            ok: false,
            message: "Please wait.",
            request: { id: "x", action: { type: "present" } },
          },
        },
        context,
      ),
    ).toEqual({
      type: "attention:state",
      payload: { id: "x", ok: false, message: "Please wait." },
    });
    expect(
      filterAttentionFrame(
        {
          type: "attention:state",
          payload: { ok: false, message: "Please wait.", request: "x" },
        },
        context,
      ),
    ).toEqual({
      type: "attention:state",
      payload: { id: undefined, ok: false, message: "Please wait." },
    });
  });

  it("filters members carried by state, join, and sync frames", () => {
    const state = filterAttentionFrame(
      { type: "attention:state", payload: { member: sender } },
      { sharedAttention: 1, sessionId: "bystander" },
    );
    expect(state).toMatchObject({
      payload: { member: { collaboration: { invitation: null } } },
    });
    expect(state).not.toHaveProperty("payload.member.attentionReceipts");
    expect(
      filterAttentionFrame(
        { type: "join", payload: { user: sender } },
        context,
      ),
    ).toMatchObject({
      payload: {
        user: { collaboration: { invitation: { id: "invitation" } } },
      },
    });
    for (const type of ["presence:sync", "presence:sync-response"] as const) {
      expect(
        filterAttentionFrame(
          { type, payload: { users: [sender, "not-a-user"] } },
          context,
        ),
      ).toMatchObject({ payload: { users: [{ sessionId: "sender" }] } });
      expect(
        filterAttentionFrame({ type, payload: { users: "none" } }, context),
      ).toEqual({ type, payload: { users: "none" } });
    }
  });
});
