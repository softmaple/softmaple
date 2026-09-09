import { describe, expect, it } from "vitest";
import { createPresenceUser } from "../types/presence";
import { summarizePresence } from "./summary";

const member = (userId: string, connectionId: string, lastSeenAt = 40_000) => ({
  ...createPresenceUser({
    userId,
    connectionId,
    name: "Private name",
    color: "#175bb5",
  }),
  lastSeenAt,
  lastActivityAt: 40_000,
  meta: { activity: "editing", foreground: true },
});
describe("authorized room overview payload", () => {
  it("groups tabs, expires stale members, and contains no detailed activity", () => {
    expect(
      summarizePresence(
        [
          member("one", "a"),
          member("one", "b"),
          member("expired", "c", 1),
          { ...member("hidden", "d"), meta: { foreground: false } },
          null,
        ],
        40_001,
      ),
    ).toEqual({ people: 2, editing: 1 });
  });
  it("stops advertising editing after the activity freshness window", () => {
    expect(summarizePresence([member("one", "a")], 46_000)).toEqual({
      people: 1,
      editing: 0,
    });
  });
});
