import { describe, expect, it } from "vitest";
import {
  canDeleteDocument,
  canEditDocument,
  canShareDocument,
} from "./permissions";

describe("document permissions", () => {
  it.each([
    ["OWNER", true, true],
    ["EDITOR", true, false],
    ["VIEWER", false, false],
  ] as const)("maps %s edit and share capabilities", (role, edit, share) => {
    expect(canEditDocument(role)).toBe(edit);
    expect(canShareDocument(role)).toBe(share);
  });

  it("allows editors to delete only their own documents", () => {
    expect(canDeleteDocument("EDITOR", "member-1", "member-1")).toBe(true);
    expect(canDeleteDocument("EDITOR", "member-2", "member-1")).toBe(false);
    expect(canDeleteDocument("OWNER", "member-2", "member-1")).toBe(true);
    expect(canDeleteDocument("VIEWER", "member-1", "member-1")).toBe(false);
  });
});
