import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyClockedPresenceUpdate,
  createPresenceUser,
  markUserActivity,
  patchPresenceUser,
  touchUserSeen,
} from "../types/presence";
import {
  createPresenceStore,
  derivePresenceStatus,
  PRESENCE_PROTOCOL_VERSION,
} from "./index";

const NOW = 10_000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("derivePresenceStatus", () => {
  const config = { idleTimeoutMs: 1_000, offlineTimeoutMs: 5_000 };

  it("keeps active when both clocks are fresh", () => {
    expect(
      derivePresenceStatus(
        { lastActivityAt: NOW - 100, lastSeenAt: NOW - 100 },
        config,
        NOW,
      ),
    ).toBe("active");
  });

  it("becomes idle when activity is stale but still seen", () => {
    expect(
      derivePresenceStatus(
        { lastActivityAt: NOW - 2_000, lastSeenAt: NOW - 100 },
        config,
        NOW,
      ),
    ).toBe("idle");
  });

  it("becomes offline when lastSeenAt expires even if activity looks fresh", () => {
    expect(
      derivePresenceStatus(
        { lastActivityAt: NOW - 100, lastSeenAt: NOW - 10_000 },
        config,
        NOW,
      ),
    ).toBe("offline");
  });
});

describe("activity vs liveness APIs", () => {
  it("patchPresenceUser never bumps timestamps", () => {
    const user = createPresenceUser({
      userId: "a",
      name: "A",
      color: "#000",
      lastActivityAt: 1,
      lastSeenAt: 2,
      clock: 3,
    });
    const patched = patchPresenceUser(user, { status: "idle", name: "B" });
    expect(patched.lastActivityAt).toBe(1);
    expect(patched.lastSeenAt).toBe(2);
    expect(patched.clock).toBe(3);
    expect(patched.status).toBe("idle");
    expect(patched.name).toBe("B");
  });

  it("touchUserSeen updates only lastSeenAt", () => {
    const user = createPresenceUser({
      userId: "a",
      name: "A",
      color: "#000",
      lastActivityAt: 1,
      lastSeenAt: 2,
      status: "idle",
    });
    const touched = touchUserSeen(user, NOW);
    expect(touched.lastActivityAt).toBe(1);
    expect(touched.lastSeenAt).toBe(NOW);
    expect(touched.status).toBe("idle");
    expect(touched.clock).toBe(user.clock);
  });

  it("markUserActivity bumps activity, seen, status, and clock", () => {
    const user = createPresenceUser({
      userId: "a",
      name: "A",
      color: "#000",
      lastActivityAt: 1,
      lastSeenAt: 2,
      clock: 5,
      status: "idle",
    });
    const active = markUserActivity(user, NOW, {
      cursor: { blockId: "b", offset: 1 },
    });
    expect(active.lastActivityAt).toBe(NOW);
    expect(active.lastSeenAt).toBe(NOW);
    expect(active.status).toBe("active");
    expect(active.clock).toBe(6);
    expect(active.cursor).toEqual({ blockId: "b", offset: 1 });
  });

  it("applyClockedPresenceUpdate rejects stale clocks but refreshes seen", () => {
    const user = createPresenceUser({
      userId: "a",
      name: "A",
      color: "#000",
      clock: 10,
      lastActivityAt: 1,
      lastSeenAt: 2,
    });
    const stale = applyClockedPresenceUpdate(user, 9, { name: "stale" }, NOW);
    expect(stale?.name).toBe("A");
    expect(stale?.lastSeenAt).toBe(NOW);
    expect(stale?.clock).toBe(10);

    const fresh = applyClockedPresenceUpdate(
      user,
      11,
      { name: "fresh", lastActivityAt: NOW },
      NOW,
    );
    expect(fresh?.name).toBe("fresh");
    expect(fresh?.clock).toBe(11);
    expect(fresh?.lastActivityAt).toBe(NOW);
  });
});

describe("createPresenceStore", () => {
  it("keys sessions by connectionId and supports multi-tab same userId", () => {
    const store = createPresenceStore({
      timeouts: { idleTimeoutMs: 1_000, offlineTimeoutMs: 5_000 },
    });
    const a1 = createPresenceUser({
      connectionId: "c1",
      userId: "adam",
      name: "Adam",
      color: "#f00",
    });
    const a2 = createPresenceUser({
      connectionId: "c2",
      userId: "adam",
      name: "Adam",
      color: "#f00",
    });
    store.upsertSession(a1);
    store.upsertSession(a2);
    expect(store.getPresence().size).toBe(2);
    store.removeSession("c1");
    expect(store.getPresence().has("c2")).toBe(true);
    expect(store.getPresence().has("c1")).toBe(false);
  });

  it("sweepStatuses demotes idle without requiring offline", () => {
    const store = createPresenceStore({
      timeouts: { idleTimeoutMs: 1_000, offlineTimeoutMs: 5_000 },
    });
    store.upsertSession(
      createPresenceUser({
        connectionId: "c1",
        userId: "a",
        name: "A",
        color: "#000",
        lastActivityAt: NOW - 2_000,
        lastSeenAt: NOW - 100,
        status: "active",
      }),
    );
    const transitions = store.sweepStatuses(NOW);
    expect(transitions).toHaveLength(1);
    expect(store.getSession("c1")?.status).toBe("idle");
  });
});

describe("protocol", () => {
  it("exposes protocol version 2", () => {
    expect(PRESENCE_PROTOCOL_VERSION).toBe(2);
  });
});
