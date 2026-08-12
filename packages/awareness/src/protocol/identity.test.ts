import { describe, expect, it } from "vitest";
import { deterministicPresenceColor } from "./identity";

describe("deterministicPresenceColor", () => {
  it("assigns a stable color for the same userId", () => {
    expect(deterministicPresenceColor("user-1")).toBe(
      deterministicPresenceColor("user-1"),
    );
  });

  it("returns one of the fixed palette colors", () => {
    const palette = ["#e11d48", "#0f766e", "#c2410c", "#7c3aed", "#0369a1"];
    for (const userId of ["a", "b", "c", "user-42", ""]) {
      expect(palette).toContain(deterministicPresenceColor(userId));
    }
  });
});
