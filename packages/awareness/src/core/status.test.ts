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
  createSelfSession,
  derivePresenceStatus,
  isUserIdle,
  isUserOffline,
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
    expect(stale.name).toBe("A");
    expect(stale.lastSeenAt).toBe(NOW);
    expect(stale.clock).toBe(10);

    const fresh = applyClockedPresenceUpdate(
      user,
      11,
      { name: "fresh", lastActivityAt: NOW, lastSeenAt: NOW - 50 },
      NOW,
    );
    expect(fresh.name).toBe("fresh");
    expect(fresh.clock).toBe(11);
    expect(fresh.lastActivityAt).toBe(NOW);
    // lastSeenAt is monotonic vs prior value, wire stamp, and receipt time.
    expect(fresh.lastSeenAt).toBe(NOW);
  });

  it("touchUserSeen never decreases lastSeenAt", () => {
    const user = createPresenceUser({
      userId: "a",
      name: "A",
      color: "#000",
      lastSeenAt: 500,
    });
    expect(touchUserSeen(user, 100).lastSeenAt).toBe(500);
    expect(touchUserSeen(user, 800).lastSeenAt).toBe(800);
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

  it("setSelf upserts into the map and keeps self in sync on later writes", () => {
    const store = createPresenceStore();
    const self = createPresenceUser({
      connectionId: "self",
      userId: "me",
      name: "Me",
      color: "#111",
      clock: 1,
    });
    store.setSelf(self);
    expect(store.getSelf()?.connectionId).toBe("self");
    expect(store.getSession("self")?.name).toBe("Me");

    store.markActivity("self", { name: "Updated" }, NOW);
    expect(store.getSelf()?.name).toBe("Updated");
    expect(store.getSelf()?.clock).toBe(2);

    store.setSelf(null);
    expect(store.getSelf()).toBeNull();
    // Presence map retains the session; only the self pointer clears.
    expect(store.getSession("self")).toBeDefined();
  });

  it("removeSession clears self when removing the local session", () => {
    const store = createPresenceStore();
    const self = createPresenceUser({
      connectionId: "self",
      userId: "me",
      name: "Me",
      color: "#111",
    });
    store.setSelf(self);
    expect(store.removeSession("missing")).toBe(false);
    expect(store.removeSession("self")).toBe(true);
    expect(store.getSelf()).toBeNull();
    expect(store.getSession("self")).toBeUndefined();
  });

  it("applyRemoteUpdate rejects unknown sessions and applies clocked patches", () => {
    const store = createPresenceStore();
    expect(store.applyRemoteUpdate("missing", 1, { name: "x" })).toBeNull();

    store.upsertSession(
      createPresenceUser({
        connectionId: "c1",
        userId: "a",
        name: "A",
        color: "#000",
        clock: 5,
        lastActivityAt: 1,
        lastSeenAt: 2,
      }),
    );

    const stale = store.applyRemoteUpdate("c1", 4, { name: "stale" }, NOW);
    expect(stale?.name).toBe("A");
    expect(stale?.lastSeenAt).toBe(NOW);
    expect(stale?.clock).toBe(5);

    const fresh = store.applyRemoteUpdate(
      "c1",
      6,
      { name: "fresh", lastActivityAt: NOW },
      NOW,
    );
    expect(fresh?.name).toBe("fresh");
    expect(fresh?.clock).toBe(6);
    expect(fresh?.lastActivityAt).toBe(NOW);
  });

  it("markActivity and touchSeen no-op for unknown sessions", () => {
    const store = createPresenceStore();
    expect(store.markActivity("missing")).toBeNull();
    expect(store.touchSeen("missing")).toBeNull();

    store.upsertSession(
      createPresenceUser({
        connectionId: "c1",
        userId: "a",
        name: "A",
        color: "#000",
        lastActivityAt: 1,
        lastSeenAt: 2,
        status: "idle",
      }),
    );
    const seen = store.touchSeen("c1", NOW);
    expect(seen?.lastSeenAt).toBe(NOW);
    expect(seen?.lastActivityAt).toBe(1);
    expect(seen?.status).toBe("idle");
  });

  it("sweepStatuses is a no-op when nothing transitions", () => {
    const store = createPresenceStore({
      timeouts: { idleTimeoutMs: 1_000, offlineTimeoutMs: 5_000 },
    });
    store.upsertSession(
      createPresenceUser({
        connectionId: "c1",
        userId: "a",
        name: "A",
        color: "#000",
        lastActivityAt: NOW,
        lastSeenAt: NOW,
        status: "active",
      }),
    );
    expect(store.sweepStatuses(NOW)).toEqual([]);
    expect(store.getSession("c1")?.status).toBe("active");
  });

  it("sweepStatuses updates self when the local session transitions", () => {
    const store = createPresenceStore({
      timeouts: { idleTimeoutMs: 1_000, offlineTimeoutMs: 5_000 },
    });
    const self = createPresenceUser({
      connectionId: "self",
      userId: "me",
      name: "Me",
      color: "#111",
      lastActivityAt: NOW - 2_000,
      lastSeenAt: NOW - 100,
      status: "active",
    });
    store.setSelf(self);
    store.sweepStatuses(NOW);
    expect(store.getSelf()?.status).toBe("idle");
  });

  it("replaceAll swaps the map while preserving self", () => {
    const store = createPresenceStore();
    const self = createPresenceUser({
      connectionId: "self",
      userId: "me",
      name: "Me",
      color: "#111",
    });
    store.setSelf(self);
    store.replaceAll([
      createPresenceUser({
        connectionId: "peer",
        userId: "peer",
        name: "Peer",
        color: "#222",
      }),
    ]);
    expect(store.getPresence().size).toBe(2);
    expect(store.getSession("peer")?.name).toBe("Peer");
    expect(store.getSession("self")?.name).toBe("Me");
  });

  it("subscribe notifies on mutations and unsubscribe stops delivery", () => {
    const store = createPresenceStore();
    const seen: number[] = [];
    const unsubscribe = store.subscribe((presence) => {
      seen.push(presence.size);
    });
    store.upsertSession(
      createPresenceUser({
        connectionId: "c1",
        userId: "a",
        name: "A",
        color: "#000",
      }),
    );
    unsubscribe();
    store.upsertSession(
      createPresenceUser({
        connectionId: "c2",
        userId: "b",
        name: "B",
        color: "#000",
      }),
    );
    expect(seen).toEqual([1]);
  });
});

describe("isUserIdle / isUserOffline", () => {
  const config = { idleTimeoutMs: 1_000, offlineTimeoutMs: 5_000 };

  it("reports idle and offline independently", () => {
    expect(
      isUserOffline({ lastSeenAt: NOW - 6_000 }, config.offlineTimeoutMs, NOW),
    ).toBe(true);
    expect(
      isUserIdle(
        { lastActivityAt: NOW - 2_000, lastSeenAt: NOW - 100 },
        config,
        NOW,
      ),
    ).toBe(true);
    expect(
      isUserIdle(
        { lastActivityAt: NOW - 100, lastSeenAt: NOW - 100 },
        config,
        NOW,
      ),
    ).toBe(false);
  });
});

describe("createSelfSession", () => {
  it("builds a local session from user info", () => {
    const session = createSelfSession({
      connectionId: "c-local",
      userId: "u",
      name: "Local",
      color: "#abc",
    });
    expect(session.connectionId).toBe("c-local");
    expect(session.userId).toBe("u");
  });
});

describe("protocol", () => {
  it("exposes protocol version 2", () => {
    expect(PRESENCE_PROTOCOL_VERSION).toBe(2);
  });
});
