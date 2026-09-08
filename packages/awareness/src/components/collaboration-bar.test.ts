import { describe, expect, it } from "vitest";
import type { PresenceUser } from "../types/presence";
import { groupCollaborators } from "./collaboration-bar";

const user = (
  userId: string,
  overrides: Partial<PresenceUser> = {},
): PresenceUser => ({
  userId,
  connectionId: userId,
  name: userId,
  color: "#2563eb",
  status: "active",
  lastActivityAt: 10,
  lastSeenAt: 10,
  clock: 0,
  ...overrides,
});

describe("document roster", () => {
  it("counts live sessions once per person and keeps their active session", () => {
    const active = user("Maya", { connectionId: "active", lastActivityAt: 20 });
    const result = groupCollaborators([
      user("Maya", { connectionId: "away", status: "idle" }),
      user("Maya", { connectionId: "expired", status: "offline" }),
      active,
      user("Alex", { status: "offline" }),
    ]);
    expect(result).toEqual([{ user: active, sessions: 2 }]);
  });
  it("keeps self first and does not reshuffle people as they type", () => {
    const people = [user("Noor"), user("Alex"), user("Maya")];
    const before = groupCollaborators(people, "Maya").map(
      ({ user }) => user.userId,
    );
    const after = groupCollaborators(
      people.map((person) => ({
        ...person,
        lastActivityAt: person.userId === "Noor" ? 1000 : 0,
      })),
      "Maya",
    ).map(({ user }) => user.userId);
    expect(before).toEqual(["Maya", "Alex", "Noor"]);
    expect(after).toEqual(before);
  });
  it("keeps different accounts with the same display name distinct", () => {
    expect(
      groupCollaborators([
        user("a", { name: "Alex" }),
        user("b", { name: "Alex" }),
      ]),
    ).toHaveLength(2);
  });
});
