import { describe, expect, it } from "vitest";
import {
  isDocumentEditable,
  permissionFromRole,
} from "@/modules/docs/document-editability";

describe("isDocumentEditable", () => {
  it("should keep owner and editor documents editable", () => {
    expect(
      isDocumentEditable({ permission: "owner", sessionMode: "authenticated" }),
    ).toBe(true);
    expect(
      isDocumentEditable({
        permission: "editor",
        sessionMode: "authenticated",
      }),
    ).toBe(true);
  });

  it("should keep viewer and public sessions read-only", () => {
    expect(
      isDocumentEditable({
        permission: "viewer",
        sessionMode: "authenticated",
      }),
    ).toBe(false);
    expect(
      isDocumentEditable({ permission: "owner", sessionMode: "public" }),
    ).toBe(false);
    expect(
      isDocumentEditable({ permission: null, sessionMode: "authenticated" }),
    ).toBe(false);
  });

  it("should ignore save and collaboration connection concerns", () => {
    // Editability is intentionally permission-only. Callers must not pass
    // saveStatus/collaborationStatus into this helper.
    const editableWhileSaving = isDocumentEditable({
      permission: "editor",
      sessionMode: "authenticated",
    });
    const editableWhileConnecting = isDocumentEditable({
      permission: "owner",
      sessionMode: "authenticated",
    });
    expect(editableWhileSaving).toBe(true);
    expect(editableWhileConnecting).toBe(true);
  });
});

describe("permissionFromRole", () => {
  it("should map workspace roles to document permissions", () => {
    expect(permissionFromRole("OWNER")).toBe("owner");
    expect(permissionFromRole("EDITOR")).toBe("editor");
    expect(permissionFromRole("VIEWER")).toBe("viewer");
    expect(permissionFromRole(null)).toBeNull();
  });
});
