import { describe, expect, it } from "vitest";
import { deterministicPresenceColor } from "./identity";

describe("deterministicPresenceColor", () => {
  it("assigns a stable color for the same userId", () => {
    expect(deterministicPresenceColor("user-1")).toBe(
      deterministicPresenceColor("user-1"),
    );
  });

  it("returns one of the fixed palette colors", () => {
    const palette = ["#175bb5", "#08796f", "#943b77", "#b63f38", "#7050b4"];
    for (const userId of ["a", "b", "c", "user-42", ""]) {
      expect(palette).toContain(deterministicPresenceColor(userId));
    }
  });
});
