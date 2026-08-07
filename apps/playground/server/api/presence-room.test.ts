import { describe, expect, it } from "vitest";
import {
  createPresenceRoomStore,
  handlePresenceFrame,
  parsePresenceMessage,
  PRESENCE_PROTOCOL_VERSION,
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
): ReturnType<typeof parsePresenceMessage> =>
  parsePresenceMessage(
    JSON.stringify({
      type,
      roomId: "room-a",
      senderId,
      timestamp: 1_000,
      payload,
    }),
  );

describe("playground presence protocol v2", () => {
  it("parses valid frames and rejects malformed JSON", () => {
    expect(parsePresenceMessage("{")).toBeNull();
    expect(frame("heartbeat", { pingId: "p1" })?.type).toBe("heartbeat");
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
  });

  it("keys the roster by connectionId so one userId can have multiple sessions", () => {
    const store = createPresenceRoomStore();
    const join1 = frame("join", { user: user("c1", "ada", 0) }, "c1")!;
    const join2 = frame("join", { user: user("c2", "ada", 0) }, "c2")!;
    handlePresenceFrame(store, "room-a", join1);
    const second = handlePresenceFrame(store, "room-a", join2);
    expect(store.listUsers("room-a")).toHaveLength(2);
    const syncUsers = (
      second.outbound[0]?.payload as { users: unknown[] } | undefined
    )?.users;
    expect(syncUsers).toHaveLength(2);
  });

  it("enforces incoming clock ordering on presence:update", () => {
    const store = createPresenceRoomStore();
    handlePresenceFrame(
      store,
      "room-a",
      frame("join", { user: user("c1", "ada", 5) }, "c1")!,
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
    );
    expect(fresh.publish).not.toBeNull();
    expect(store.getUsers("room-a").get("c1")?.name).toBe("fresh");
    expect(store.getUsers("room-a").get("c1")?.clock).toBe(6);
  });

  it("echoes pingId on heartbeat:ack", () => {
    const store = createPresenceRoomStore();
    const result = handlePresenceFrame(
      store,
      "room-a",
      frame("heartbeat", { pingId: "ping-42" })!,
    );
    expect(result.outbound[0]).toMatchObject({
      type: "heartbeat:ack",
      payload: { pingId: "ping-42" },
    });
  });

  it("removes only the leaving connectionId", () => {
    const store = createPresenceRoomStore();
    handlePresenceFrame(
      store,
      "room-a",
      frame("join", { user: user("c1", "ada") }, "c1")!,
    );
    handlePresenceFrame(
      store,
      "room-a",
      frame("join", { user: user("c2", "ada") }, "c2")!,
    );
    handlePresenceFrame(
      store,
      "room-a",
      frame("leave", { connectionId: "c1", userId: "ada" }, "c1")!,
    );
    expect(store.listUsers("room-a").map((u) => u.connectionId)).toEqual([
      "c2",
    ]);
  });
});
