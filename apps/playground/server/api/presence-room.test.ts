import { describe, expect, it } from "vitest";
import {
  buildCloseLeaveMessage,
  createPresenceRoomStore,
  handlePresenceFrame,
  parsePresenceMessage,
  PRESENCE_PROTOCOL_VERSION,
  type PeerSession,
} from "./presence-room";

const user = (
  connectionId: string,
  userId: string,
  clock = 0,
): Record<string, unknown> => ({
  connectionId,
  userId,
  name: userId,
  color: "#000",
  clock,
  lastActivityAt: 1,
  lastSeenAt: 1,
  status: "active",
});

const frame = (
  type: string,
  payload?: unknown,
  senderId = "c1",
  roomId = "room-a",
): ReturnType<typeof parsePresenceMessage> =>
  parsePresenceMessage(
    JSON.stringify({
      type,
      roomId,
      senderId,
      timestamp: 1_000,
      payload,
    }),
  );

const session = (overrides: Partial<PeerSession> = {}): PeerSession => ({
  roomId: "room-a",
  connectionId: "c1",
  userId: "ada",
  ...overrides,
});

describe("playground presence protocol v2", () => {
  it("parses valid frames and rejects malformed JSON", () => {
    expect(parsePresenceMessage("{")).toBeNull();
    expect(frame("heartbeat", { pingId: "p1" })?.type).toBe("heartbeat");
  });

  it("rejects non-finite timestamps and non-string wire fields", () => {
    expect(
      parsePresenceMessage(
        JSON.stringify({
          type: 1,
          roomId: "room-a",
          senderId: "c1",
          timestamp: 1_000,
        }),
      ),
    ).toBeNull();
    expect(
      parsePresenceMessage(
        JSON.stringify({
          type: "join",
          roomId: 42,
          senderId: "c1",
          timestamp: 1_000,
        }),
      ),
    ).toBeNull();
    expect(
      parsePresenceMessage(
        JSON.stringify({
          type: "join",
          roomId: "room-a",
          senderId: null,
          timestamp: 1_000,
        }),
      ),
    ).toBeNull();
    expect(
      parsePresenceMessage(
        JSON.stringify({
          type: "join",
          roomId: "room-a",
          senderId: "c1",
          timestamp: Number.NaN,
        }),
      ),
    ).toBeNull();
  });

  it("replies auth_ok for valid protocol v2 auth frames", () => {
    const store = createPresenceRoomStore();
    const parsed = frame("auth", {
      token: "demo",
      protocolVersion: PRESENCE_PROTOCOL_VERSION,
      capabilities: { connectionId: true },
      connectionId: "c1",
      userId: "ada",
    });
    expect(parsed).not.toBeNull();
    const result = handlePresenceFrame(store, "room-a", parsed!);
    expect(result.outbound[0]?.type).toBe("auth_ok");
    expect(result.session).toEqual({ connectionId: "c1", userId: "ada" });
  });

  it("rejects auth frames with the wrong protocol version", () => {
    const store = createPresenceRoomStore();
    const parsed = frame("auth", {
      token: "demo",
      protocolVersion: 1,
      connectionId: "c1",
      userId: "ada",
    });
    const result = handlePresenceFrame(store, "room-a", parsed!);
    expect(result.outbound[0]?.type).toBe("auth_error");
    expect(result.session).toBeUndefined();
  });

  it("rejects empty auth tokens", () => {
    const store = createPresenceRoomStore();
    const parsed = frame("auth", {
      token: "",
      protocolVersion: PRESENCE_PROTOCOL_VERSION,
      connectionId: "c1",
      userId: "ada",
    });
    const result = handlePresenceFrame(store, "room-a", parsed!);
    expect(result.outbound[0]?.type).toBe("auth_error");
    expect(result.session).toBeUndefined();
  });

  it("ignores frames for a mismatched roomId", () => {
    const store = createPresenceRoomStore();
    const parsed = frame("heartbeat", { pingId: "p1" }, "c1", "other-room");
    const result = handlePresenceFrame(store, "room-a", parsed!, session());
    expect(result.outbound).toEqual([]);
    expect(result.publish).toBeNull();
  });

  it("keys the roster by connectionId so one userId can have multiple sessions", () => {
    const store = createPresenceRoomStore();
    const join1 = frame("join", { user: user("c1", "ada", 0) }, "c1")!;
    const join2 = frame("join", { user: user("c2", "ada", 0) }, "c2")!;
    handlePresenceFrame(store, "room-a", join1, session({ connectionId: "c1" }));
    const second = handlePresenceFrame(
      store,
      "room-a",
      join2,
      session({ connectionId: "c2", userId: "ada" }),
    );
    expect(store.listUsers("room-a")).toHaveLength(2);
    const syncUsers = (
      second.outbound[0]?.payload as { users: unknown[] } | undefined
    )?.users;
    expect(syncUsers).toHaveLength(2);
  });

  it("rejects join when payload connectionId differs from session", () => {
    const store = createPresenceRoomStore();
    const parsed = frame("join", { user: user("other", "ada") }, "c1")!;
    const result = handlePresenceFrame(
      store,
      "room-a",
      parsed,
      session({ connectionId: "c1" }),
    );
    expect(result.publish).toBeNull();
    expect(store.listUsers("room-a")).toHaveLength(0);
  });

  it("enforces incoming clock ordering on presence:update", () => {
    const store = createPresenceRoomStore();
    handlePresenceFrame(
      store,
      "room-a",
      frame("join", { user: user("c1", "ada", 5) }, "c1")!,
      session(),
    );

    const stale = handlePresenceFrame(
      store,
      "room-a",
      frame(
        "presence:update",
        {
          connectionId: "c1",
          userId: "ada",
          clock: 4,
          updates: { name: "stale" },
        },
        "c1",
      )!,
      session(),
    );
    expect(stale.publish).not.toBeNull();
    expect(store.getUsers("room-a").get("c1")?.name).toBe("ada");
    expect(store.getUsers("room-a").get("c1")?.clock).toBe(5);

    const fresh = handlePresenceFrame(
      store,
      "room-a",
      frame(
        "presence:update",
        {
          connectionId: "c1",
          userId: "ada",
          clock: 6,
          updates: { name: "fresh" },
        },
        "c1",
      )!,
      session(),
    );
    expect(fresh.publish).not.toBeNull();
    expect(store.getUsers("room-a").get("c1")?.name).toBe("fresh");
    expect(store.getUsers("room-a").get("c1")?.clock).toBe(6);
  });

  it("refreshes lastSeenAt on stale updates even without wire lastSeenAt", () => {
    const store = createPresenceRoomStore();
    handlePresenceFrame(
      store,
      "room-a",
      frame("join", { user: user("c1", "ada", 5) }, "c1")!,
      session(),
    );
    const before = store.getUsers("room-a").get("c1")?.lastSeenAt ?? 0;
    handlePresenceFrame(
      store,
      "room-a",
      frame(
        "presence:update",
        {
          connectionId: "c1",
          userId: "ada",
          clock: 4,
          updates: {},
        },
        "c1",
      )!,
      session(),
    );
    const after = store.getUsers("room-a").get("c1")?.lastSeenAt ?? 0;
    expect(after).toBeGreaterThanOrEqual(before);
  });

  it("does not publish updates for unknown session connectionIds", () => {
    const store = createPresenceRoomStore();
    const result = handlePresenceFrame(
      store,
      "room-a",
      frame(
        "presence:update",
        {
          connectionId: "missing",
          userId: "ada",
          clock: 1,
          updates: { name: "x" },
        },
        "missing",
      )!,
      session({ connectionId: "missing" }),
    );
    expect(result.publish).toBeNull();
  });

  it("echoes pingId on heartbeat:ack", () => {
    const store = createPresenceRoomStore();
    const result = handlePresenceFrame(
      store,
      "room-a",
      frame("heartbeat", { pingId: "ping-42" })!,
      session(),
    );
    expect(result.outbound[0]).toMatchObject({
      type: "heartbeat:ack",
      payload: { pingId: "ping-42" },
    });
  });

  it("removes only the leaving session connectionId", () => {
    const store = createPresenceRoomStore();
    handlePresenceFrame(
      store,
      "room-a",
      frame("join", { user: user("c1", "ada") }, "c1")!,
      session({ connectionId: "c1" }),
    );
    handlePresenceFrame(
      store,
      "room-a",
      frame("join", { user: user("c2", "ada") }, "c2")!,
      session({ connectionId: "c2" }),
    );
    handlePresenceFrame(
      store,
      "room-a",
      frame("leave", { connectionId: "other", userId: "ada" }, "c1")!,
      session({ connectionId: "c1" }),
    );
    expect(store.listUsers("room-a").map((u) => u.connectionId)).toEqual([
      "c2",
    ]);
  });

  it("deleteRoomIfEmpty removes empty rooms", () => {
    const store = createPresenceRoomStore();
    handlePresenceFrame(
      store,
      "room-a",
      frame("join", { user: user("c1", "ada") }, "c1")!,
      session(),
    );
    store.leave("room-a", "c1");
    store.deleteRoomIfEmpty("room-a");
    expect(store.listUsers("room-a")).toHaveLength(0);
  });

  it("buildCloseLeaveMessage includes connectionId and userId", () => {
    const message = buildCloseLeaveMessage("room-a", "c1", "ada");
    expect(message).toMatchObject({
      type: "leave",
      roomId: "room-a",
      payload: { connectionId: "c1", userId: "ada" },
    });
  });

  it("drops oversized update payloads", () => {
    const store = createPresenceRoomStore({ maxUpdateBytes: 32 });
    handlePresenceFrame(
      store,
      "room-a",
      frame("join", { user: user("c1", "ada", 0) }, "c1")!,
      session(),
    );
    const result = handlePresenceFrame(
      store,
      "room-a",
      frame(
        "presence:update",
        {
          connectionId: "c1",
          userId: "ada",
          clock: 1,
          updates: { name: "x".repeat(100) },
        },
        "c1",
      )!,
      session(),
    );
    expect(result.publish).toBeNull();
  });
});
