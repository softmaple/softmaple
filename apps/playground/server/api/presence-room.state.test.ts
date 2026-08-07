import { describe, expect, it } from "vitest";
import {
  buildCloseLeaveMessage,
  createPresenceRoomStore,
  handlePresenceFrame,
} from "./presence-room";
import { frame, session, user } from "./presence-room.test-helpers";

describe("presence room roster and lifecycle", () => {
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
});
