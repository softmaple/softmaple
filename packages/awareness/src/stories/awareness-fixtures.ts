import { ACTIVITY_TYPE } from "../constants/presence-events";
import type { ActivityEvent } from "../types/events";
import type { PresenceUser } from "../types/presence";

const baseTime = Date.UTC(2026, 4, 10, 9, 30);

export const ada = {
  userId: "ada",
  name: "Ada Lovelace",
  color: "#2563eb",
  status: "active",
  lastActiveAt: baseTime + 4000,
  cursor: { blockId: "abstract", offset: 42 },
  selection: { blockId: "abstract", from: 12, to: 56 },
  meta: { isTyping: true },
} satisfies PresenceUser;

export const grace = {
  userId: "grace",
  name: "Grace Hopper",
  color: "#dc2626",
  status: "active",
  lastActiveAt: baseTime + 3000,
  cursor: { blockId: "methods", offset: 18 },
} satisfies PresenceUser;

export const katherine = {
  userId: "katherine",
  name: "Katherine Johnson",
  color: "#16a34a",
  status: "idle",
  lastActiveAt: baseTime + 2000,
  selection: { blockId: "results", from: 4, to: 27 },
} satisfies PresenceUser;

export const alan = {
  userId: "alan",
  name: "Alan Turing",
  color: "#9333ea",
  status: "idle",
  lastActiveAt: baseTime + 1000,
} satisfies PresenceUser;

export const mary = {
  userId: "mary",
  name: "Mary Jackson",
  color: "#ea580c",
  status: "offline",
  lastActiveAt: baseTime,
} satisfies PresenceUser;

export const dorothy = {
  userId: "dorothy",
  name: "Dorothy Vaughan",
  color: "#0891b2",
  status: "active",
  lastActiveAt: baseTime + 5000,
} satisfies PresenceUser;

export const collaborators = [
  ada,
  grace,
  katherine,
  alan,
  mary,
  dorothy,
] satisfies ReadonlyArray<PresenceUser>;

export const usersById = new Map(
  collaborators.map((user) => [user.userId, user]),
) satisfies ReadonlyMap<string, PresenceUser>;

export const recentActivities = [
  {
    userId: "ada",
    timestamp: baseTime + 6000,
    type: ACTIVITY_TYPE.TYPING,
    data: { type: ACTIVITY_TYPE.TYPING, isTyping: true },
  },
  {
    userId: "grace",
    timestamp: baseTime + 5000,
    type: ACTIVITY_TYPE.CURSOR,
    data: {
      type: ACTIVITY_TYPE.CURSOR,
      position: { blockId: "methods", offset: 18 },
    },
  },
  {
    userId: "katherine",
    timestamp: baseTime + 4000,
    type: ACTIVITY_TYPE.SELECTION,
    data: {
      type: ACTIVITY_TYPE.SELECTION,
      range: { blockId: "results", from: 4, to: 27 },
    },
  },
  {
    userId: "alan",
    timestamp: baseTime + 3000,
    type: ACTIVITY_TYPE.IDLE,
    data: { type: ACTIVITY_TYPE.IDLE },
  },
] satisfies ReadonlyArray<ActivityEvent>;
