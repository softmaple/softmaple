import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ACTIVITY_TYPE,
  type ActivityType,
  createActivityEvent,
  createPresenceEvent,
} from "../types/events";
import { createPresenceUser } from "../types/presence";
import type { PresenceState } from "../types/state";
import {
  addActivity,
  clearActivities,
  getActivitiesByType,
  getActivitiesForUser,
  getLatestActivityPerUser,
  getRecentActivities,
  recordActivity,
} from "./activity-operations";
import {
  hasError,
  isConnected,
  isConnecting,
  isDisconnected,
  setConnectionStatus,
} from "./connection-operations";
import {
  clearUserCursor,
  clearUserSelection,
  getCursorsByBlock,
  getUsersInBlock,
  getUsersSelectingBlock,
  hasOtherCursorsInBlock,
  updateUserCursor,
  updateUserSelection,
} from "./cursor-operations";
import {
  createInitialPresenceState,
  DEFAULT_PRESENCE_CONFIG,
  getOnlineUsers,
  getOtherUsers,
  getSelfUser,
  getUserById,
  getUsersArray,
} from "./selectors";
import {
  countUsersByStatus,
  determineUserStatus,
  getUsersByStatus,
  markUserActive,
  removeOfflineUsers,
  updateAllUserStatuses,
} from "./status-operations";
import {
  clearUsers,
  removeUser,
  setSelfId,
  setUser,
  setUsers,
  updateUser,
} from "./user-operations";

const NOW = 10_000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

const makeUser = (
  id: string,
  overrides: Partial<ReturnType<typeof createPresenceUser>> = {},
) => ({
  ...createPresenceUser({
    connectionId: id,
    userId: id,
    name: `User ${id}`,
    color: "#000",
  }),
  ...overrides,
  // Keep lookup key stable when overrides omit connectionId
  connectionId: overrides.connectionId ?? id,
});

const makeState = (init: Partial<PresenceState> = {}): PresenceState => ({
  ...createInitialPresenceState(),
  ...init,
});

describe("user-operations", () => {
  it("setUser adds a user immutably", () => {
    const state = makeState();
    const user = makeUser("a");
    const next = setUser(state, user);
    expect(next).not.toBe(state);
    expect(next.users.get("a")).toBe(user);
    expect(state.users.size).toBe(0);
  });

  it("removeUser is a no-op when user is absent", () => {
    const state = makeState();
    expect(removeUser(state, "missing")).toBe(state);
  });

  it("removeUser drops the user when present", () => {
    const state = setUser(makeState(), makeUser("a"));
    const next = removeUser(state, "a");
    expect(next.users.has("a")).toBe(false);
    expect(state.users.has("a")).toBe(true);
  });

  it("updateUser is a no-op when user is missing", () => {
    const state = makeState();
    expect(updateUser(state, "missing", { name: "X" })).toBe(state);
  });

  it("updateUser merges fields into the existing user", () => {
    const state = setUser(makeState(), makeUser("a"));
    const next = updateUser(state, "a", { name: "Renamed" });
    expect(next.users.get("a")?.name).toBe("Renamed");
  });

  it("setSelfId records the self id", () => {
    expect(setSelfId(makeState(), "a").selfId).toBe("a");
    expect(setSelfId(makeState({ selfId: "a" }), null).selfId).toBeNull();
  });

  it("setUsers batches inserts/updates", () => {
    const next = setUsers(makeState(), [makeUser("a"), makeUser("b")]);
    expect(next.users.size).toBe(2);
  });

  it("clearUsers wipes users and selfId", () => {
    const state = setSelfId(setUser(makeState(), makeUser("a")), "a");
    const next = clearUsers(state);
    expect(next.users.size).toBe(0);
    expect(next.selfId).toBeNull();
  });
});

describe("connection-operations", () => {
  it("setConnectionStatus updates immutably", () => {
    const next = setConnectionStatus(makeState(), "connected");
    expect(next.connectionStatus).toBe("connected");
  });

  it("isConnected/isConnecting/hasError/isDisconnected match status", () => {
    expect(isConnected(makeState({ connectionStatus: "connected" }))).toBe(
      true,
    );
    expect(isConnected(makeState({ connectionStatus: "disconnected" }))).toBe(
      false,
    );
    expect(isConnecting(makeState({ connectionStatus: "connecting" }))).toBe(
      true,
    );
    expect(isConnecting(makeState({ connectionStatus: "reconnecting" }))).toBe(
      true,
    );
    expect(isConnecting(makeState({ connectionStatus: "connected" }))).toBe(
      false,
    );
    expect(hasError(makeState({ connectionStatus: "error" }))).toBe(true);
    expect(hasError(makeState({ connectionStatus: "connected" }))).toBe(false);
    expect(
      isDisconnected(makeState({ connectionStatus: "disconnected" })),
    ).toBe(true);
    expect(isDisconnected(makeState({ connectionStatus: "connected" }))).toBe(
      false,
    );
  });
});

describe("activity-operations", () => {
  const activityFor = (
    userId: string,
    type: ActivityType = ACTIVITY_TYPE.JOIN,
    ts = NOW,
  ) => ({ ...createActivityEvent(userId, type), timestamp: ts });

  it("addActivity appends and trims to maxActivities", () => {
    let state = makeState();
    for (let i = 0; i < 5; i++) {
      state = addActivity(state, activityFor(`u${i}`), {
        ...DEFAULT_PRESENCE_CONFIG,
        maxActivities: 3,
      });
    }
    expect(state.activities).toHaveLength(3);
    expect(state.activities[0]?.userId).toBe("u2");
    expect(state.activities[2]?.userId).toBe("u4");
  });

  it("addActivity uses default config when none provided", () => {
    const next = addActivity(makeState(), activityFor("a"));
    expect(next.activities).toHaveLength(1);
  });

  it("recordActivity creates and adds an activity", () => {
    const next = recordActivity(makeState(), "a", ACTIVITY_TYPE.CURSOR);
    expect(next.activities).toHaveLength(1);
    expect(next.activities[0]?.type).toBe(ACTIVITY_TYPE.CURSOR);
  });

  it("getActivitiesForUser filters by userId", () => {
    const state = makeState({
      activities: [activityFor("a"), activityFor("b"), activityFor("a")],
    });
    expect(getActivitiesForUser(state, "a")).toHaveLength(2);
    expect(getActivitiesForUser(state, "missing")).toHaveLength(0);
  });

  it("getActivitiesByType filters by type", () => {
    const state = makeState({
      activities: [
        activityFor("a", ACTIVITY_TYPE.JOIN),
        activityFor("a", ACTIVITY_TYPE.LEAVE),
        activityFor("b", ACTIVITY_TYPE.JOIN),
      ],
    });
    expect(getActivitiesByType(state, ACTIVITY_TYPE.JOIN)).toHaveLength(2);
    expect(getActivitiesByType(state, ACTIVITY_TYPE.IDLE)).toHaveLength(0);
  });

  it("getRecentActivities filters by time window", () => {
    const state = makeState({
      activities: [
        activityFor("a", ACTIVITY_TYPE.JOIN, NOW - 5_000),
        activityFor("b", ACTIVITY_TYPE.JOIN, NOW - 500),
      ],
    });
    expect(getRecentActivities(state, 1_000)).toHaveLength(1);
    expect(getRecentActivities(state, 10_000)).toHaveLength(2);
  });

  it("clearActivities returns an empty list", () => {
    const state = makeState({ activities: [activityFor("a")] });
    expect(clearActivities(state).activities).toHaveLength(0);
  });

  it("getLatestActivityPerUser returns the latest activity per user", () => {
    const state = makeState({
      activities: [
        activityFor("a", ACTIVITY_TYPE.JOIN, NOW - 100),
        activityFor("a", ACTIVITY_TYPE.LEAVE, NOW - 50),
        activityFor("b", ACTIVITY_TYPE.JOIN, NOW - 80),
      ],
    });
    const latest = getLatestActivityPerUser(state);
    expect(latest.get("a")?.type).toBe(ACTIVITY_TYPE.LEAVE);
    expect(latest.get("b")?.type).toBe(ACTIVITY_TYPE.JOIN);
  });
});

describe("cursor-operations", () => {
  it("updateUserCursor is a no-op for missing user", () => {
    const state = makeState();
    expect(
      updateUserCursor(state, "missing", { blockId: "b", offset: 0 }),
    ).toBe(state);
  });

  it("updateUserCursor sets and clears cursor", () => {
    let state = setUser(makeState(), makeUser("a"));
    state = updateUserCursor(state, "a", { blockId: "b1", offset: 5 });
    expect(state.users.get("a")?.cursor).toEqual({ blockId: "b1", offset: 5 });
    state = updateUserCursor(state, "a", null);
    expect(state.users.get("a")?.cursor).toBeUndefined();
  });

  it("updateUserSelection sets and clears selection", () => {
    let state = setUser(makeState(), makeUser("a"));
    state = updateUserSelection(state, "a", {
      blockId: "b1",
      from: 0,
      to: 5,
    });
    expect(state.users.get("a")?.selection).toEqual({
      blockId: "b1",
      from: 0,
      to: 5,
    });
    state = updateUserSelection(state, "a", null);
    expect(state.users.get("a")?.selection).toBeUndefined();
  });

  it("updateUserSelection is a no-op for missing user", () => {
    const state = makeState();
    expect(
      updateUserSelection(state, "missing", { blockId: "b", from: 0, to: 1 }),
    ).toBe(state);
  });

  it("clearUserCursor / clearUserSelection delegate to updaters", () => {
    let state = setUser(makeState(), makeUser("a"));
    state = updateUserCursor(state, "a", { blockId: "b", offset: 1 });
    state = updateUserSelection(state, "a", { blockId: "b", from: 0, to: 1 });
    state = clearUserCursor(state, "a");
    state = clearUserSelection(state, "a");
    expect(state.users.get("a")?.cursor).toBeUndefined();
    expect(state.users.get("a")?.selection).toBeUndefined();
  });

  it("getUsersInBlock / getUsersSelectingBlock filter by block id", () => {
    let state = makeState();
    state = setUser(state, makeUser("a"));
    state = setUser(state, makeUser("b"));
    state = updateUserCursor(state, "a", { blockId: "b1", offset: 0 });
    state = updateUserCursor(state, "b", { blockId: "b2", offset: 0 });
    state = updateUserSelection(state, "a", {
      blockId: "b1",
      from: 0,
      to: 1,
    });
    expect(getUsersInBlock(state, "b1")).toHaveLength(1);
    expect(getUsersInBlock(state, "missing")).toHaveLength(0);
    expect(getUsersSelectingBlock(state, "b1")).toHaveLength(1);
    expect(getUsersSelectingBlock(state, "b2")).toHaveLength(0);
  });

  it("getUsersSelectingBlock matches both directional endpoints", () => {
    let state = setUser(makeState(), makeUser("a"));
    state = updateUserSelection(state, "a", {
      anchor: {
        blockId: "b3",
        anchor: {
          type: "boundary",
          edge: "end",
          affinity: "before",
        },
      },
      focus: {
        blockId: "b1",
        anchor: {
          type: "boundary",
          edge: "start",
          affinity: "after",
        },
      },
    });

    expect(getUsersSelectingBlock(state, "b3")).toHaveLength(1);
    expect(getUsersSelectingBlock(state, "b1")).toHaveLength(1);
    expect(getUsersSelectingBlock(state, "b2")).toHaveLength(0);
  });

  it("getCursorsByBlock groups users by their cursor block", () => {
    let state = makeState();
    state = setUser(state, makeUser("a"));
    state = setUser(state, makeUser("b"));
    state = setUser(state, makeUser("c"));
    state = updateUserCursor(state, "a", { blockId: "b1", offset: 0 });
    state = updateUserCursor(state, "b", { blockId: "b1", offset: 1 });
    state = updateUserCursor(state, "c", { blockId: "b2", offset: 0 });
    const grouped = getCursorsByBlock(state);
    expect(grouped.get("b1")).toHaveLength(2);
    expect(grouped.get("b2")).toHaveLength(1);
  });

  it("hasOtherCursorsInBlock honors excludeUserId", () => {
    let state = makeState();
    state = setUser(state, makeUser("a"));
    state = setUser(state, makeUser("b"));
    state = updateUserCursor(state, "a", { blockId: "b1", offset: 0 });
    state = updateUserCursor(state, "b", { blockId: "b1", offset: 1 });
    expect(hasOtherCursorsInBlock(state, "b1")).toBe(true);
    expect(hasOtherCursorsInBlock(state, "b1", "a")).toBe(true);
    expect(hasOtherCursorsInBlock(state, "missing")).toBe(false);
  });
});

describe("status-operations", () => {
  const config = {
    ...DEFAULT_PRESENCE_CONFIG,
    idleTimeoutMs: 1_000,
    offlineTimeoutMs: 5_000,
  };

  it("determineUserStatus derives from lastSeenAt / lastActivityAt", () => {
    expect(
      determineUserStatus(
        makeUser("a", { lastActivityAt: NOW - 100, lastSeenAt: NOW - 100 }),
        config,
        NOW,
      ),
    ).toBe("active");
    expect(
      determineUserStatus(
        makeUser("a", {
          lastActivityAt: NOW - 2_000,
          lastSeenAt: NOW - 100,
        }),
        config,
        NOW,
      ),
    ).toBe("idle");
    expect(
      determineUserStatus(
        makeUser("a", {
          lastActivityAt: NOW - 10_000,
          lastSeenAt: NOW - 10_000,
        }),
        config,
        NOW,
      ),
    ).toBe("offline");
    expect(
      determineUserStatus(
        makeUser("a", {
          lastActivityAt: NOW - 100,
          lastSeenAt: NOW - 10_000,
        }),
        config,
        NOW,
      ),
    ).toBe("offline");
  });

  it("determineUserStatus uses default config when omitted", () => {
    expect(
      determineUserStatus(
        makeUser("a", { lastActivityAt: NOW, lastSeenAt: NOW }),
        undefined,
        NOW,
      ),
    ).toBe("active");
  });

  it("updateAllUserStatuses returns same reference when no changes", () => {
    const state = setUser(
      makeState(),
      makeUser("a", { lastActivityAt: NOW, lastSeenAt: NOW }),
    );
    const next = updateAllUserStatuses(state, config, NOW);
    expect(next).toBe(state);
  });

  it("updateAllUserStatuses transitions stale users to idle/offline", () => {
    let state = makeState();
    state = setUser(
      state,
      makeUser("a", { lastActivityAt: NOW - 2_000, lastSeenAt: NOW - 100 }),
    );
    state = setUser(
      state,
      makeUser("b", {
        lastActivityAt: NOW - 10_000,
        lastSeenAt: NOW - 10_000,
      }),
    );
    state = setUser(
      state,
      makeUser("c", { lastActivityAt: NOW, lastSeenAt: NOW }),
    );
    const next = updateAllUserStatuses(state, config, NOW);
    expect(next.users.get("a")?.status).toBe("idle");
    expect(next.users.get("b")?.status).toBe("offline");
    expect(next.users.get("c")?.status).toBe("active");
  });

  it("removeOfflineUsers strips offline users", () => {
    let state = makeState();
    state = setUser(state, makeUser("a", { status: "active" }));
    state = setUser(state, makeUser("b", { status: "offline" }));
    const next = removeOfflineUsers(state);
    expect(next.users.has("b")).toBe(false);
    expect(next.users.has("a")).toBe(true);
  });

  it("removeOfflineUsers returns same state when no offline users", () => {
    const state = setUser(makeState(), makeUser("a", { status: "active" }));
    expect(removeOfflineUsers(state)).toBe(state);
  });

  it("markUserActive resets status and lastActivityAt", () => {
    const state = setUser(
      makeState(),
      makeUser("a", {
        status: "idle",
        lastActivityAt: NOW - 5_000,
        lastSeenAt: NOW - 100,
      }),
    );
    const next = markUserActive(state, "a", NOW);
    expect(next.users.get("a")?.status).toBe("active");
    expect(next.users.get("a")?.lastActivityAt).toBe(NOW);
    expect(next.users.get("a")?.lastSeenAt).toBe(NOW);
  });

  it("markUserActive is a no-op for missing user", () => {
    const state = makeState();
    expect(markUserActive(state, "missing")).toBe(state);
  });

  it("getUsersByStatus / countUsersByStatus tally by status", () => {
    let state = makeState();
    state = setUser(state, makeUser("a", { status: "active" }));
    state = setUser(state, makeUser("b", { status: "idle" }));
    state = setUser(state, makeUser("c", { status: "offline" }));
    state = setUser(state, makeUser("d", { status: "active" }));
    expect(getUsersByStatus(state, "active")).toHaveLength(2);
    expect(countUsersByStatus(state)).toEqual({
      active: 2,
      idle: 1,
      offline: 1,
    });
  });
});

describe("types/state helpers", () => {
  it("getUsersArray returns all users as an array", () => {
    let state = makeState();
    state = setUser(state, makeUser("a"));
    state = setUser(state, makeUser("b"));
    expect(getUsersArray(state)).toHaveLength(2);
  });

  it("getOnlineUsers excludes offline users", () => {
    let state = makeState();
    state = setUser(state, makeUser("a", { status: "active" }));
    state = setUser(state, makeUser("b", { status: "offline" }));
    expect(getOnlineUsers(state)).toHaveLength(1);
    expect(getOnlineUsers(state)[0]?.userId).toBe("a");
  });

  it("getUserById looks up by id", () => {
    const state = setUser(makeState(), makeUser("a"));
    expect(getUserById(state, "a")?.userId).toBe("a");
    expect(getUserById(state, "missing")).toBeUndefined();
  });

  it("getSelfUser resolves the self id", () => {
    let state = setUser(makeState(), makeUser("a"));
    state = setSelfId(state, "a");
    expect(getSelfUser(state)?.userId).toBe("a");
  });

  it("getSelfUser returns undefined when selfId is null", () => {
    expect(getSelfUser(makeState())).toBeUndefined();
  });

  it("getOtherUsers excludes the self user", () => {
    let state = makeState();
    state = setUser(state, makeUser("a"));
    state = setUser(state, makeUser("b"));
    state = setSelfId(state, "a");
    const others = getOtherUsers(state);
    expect(others).toHaveLength(1);
    expect(others[0]?.userId).toBe("b");
  });
});

describe("event factories", () => {
  it("createActivityEvent stamps userId/type/timestamp", () => {
    const event = createActivityEvent("a", ACTIVITY_TYPE.JOIN);
    expect(event.userId).toBe("a");
    expect(event.type).toBe(ACTIVITY_TYPE.JOIN);
    expect(event.timestamp).toBe(NOW);
  });

  it("createActivityEvent passes through optional data", () => {
    const event = createActivityEvent("a", ACTIVITY_TYPE.TYPING, {
      type: ACTIVITY_TYPE.TYPING,
      isTyping: true,
    });
    expect(event.data).toEqual({ type: ACTIVITY_TYPE.TYPING, isTyping: true });
  });

  it("createPresenceEvent stamps the timestamp", () => {
    const payload = {
      type: "presence:join" as const,
      user: makeUser("a"),
    };
    const event = createPresenceEvent("presence:join", payload);
    expect(event.type).toBe("presence:join");
    expect(event.payload).toBe(payload);
    expect(event.timestamp).toBe(NOW);
  });
});
