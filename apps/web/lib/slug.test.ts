import { describe, expect, it } from "vitest";
import { createStableSlug, slugifyTitle } from "@/lib/slug";

describe("stable slugs", () => {
  it("creates a readable normalized prefix", () => {
    expect(slugifyTitle("  Research & Design — 2026 ")).toBe(
      "research-design-2026",
    );
  });

  it("uses a safe fallback for non-latin-only titles", () => {
    expect(slugifyTitle("论文")).toBe("untitled");
  });

  it("keeps the supplied random suffix stable", () => {
    expect(createStableSlug("My Draft", "a1b2c3")).toBe("my-draft-a1b2c3");
  });
});
