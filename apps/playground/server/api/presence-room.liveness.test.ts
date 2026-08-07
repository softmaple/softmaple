import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPresenceRoomStore, handlePresenceFrame } from "./presence-room";
import { frame, session, user } from "./presence-room.test-helpers";

describe("presence clock and liveness", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
  });

  afterEach(() => {
    vi.useRealTimers();
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
    vi.setSystemTime(10_500);
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
    expect(after).toBeGreaterThan(before);
  });

  it("rejects future lastSeenAt on stale and fresh updates", () => {
    const store = createPresenceRoomStore();
    handlePresenceFrame(
      store,
      "room-a",
      frame("join", { user: user("c1", "ada", 5) }, "c1")!,
      session(),
    );
    vi.setSystemTime(10_000);
    handlePresenceFrame(
      store,
      "room-a",
      frame(
        "presence:update",
        {
          connectionId: "c1",
          userId: "ada",
          clock: 4,
          updates: { lastSeenAt: 99_999 },
        },
        "c1",
      )!,
      session(),
    );
    expect(store.getUsers("room-a").get("c1")?.lastSeenAt).toBe(10_000);

    handlePresenceFrame(
      store,
      "room-a",
      frame(
        "presence:update",
        {
          connectionId: "c1",
          userId: "ada",
          clock: 6,
          updates: { lastSeenAt: 99_999 },
        },
        "c1",
      )!,
      session(),
    );
    expect(store.getUsers("room-a").get("c1")?.lastSeenAt).toBe(10_000);
  });
});
