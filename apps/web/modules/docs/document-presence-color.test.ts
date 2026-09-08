import { describe, expect, it } from "vitest";
import { documentPresenceColor } from "./document-presence-color";

describe("document presence colors", () => {
  it("keeps one account's color across renders and separates adjacent account IDs", () => {
    const first = documentPresenceColor("user-1");
    expect(documentPresenceColor("user-1")).toBe(first);
    expect(documentPresenceColor("user-2")).not.toBe(first);
  });
  it("returns a usable color for empty and Unicode identities", () => {
    for (const id of ["", "张三", "🌿"]) {
      expect(documentPresenceColor(id)).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});
