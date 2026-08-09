import { describe, expect, it } from "vitest";
import { ACTION_ERROR_CODE, fromDatabaseError } from "./result";

describe("action database errors", () => {
  it.each([
    ["workspace_owner_required", ACTION_ERROR_CODE.Forbidden],
    ["registered_user_not_found", ACTION_ERROR_CODE.NotFound],
    ["workspace_member_exists", ACTION_ERROR_CODE.Conflict],
    ["invalid_workspace_role", ACTION_ERROR_CODE.Validation],
  ] as const)("maps %s to %s", (message, code) => {
    expect(
      fromDatabaseError({ code: "P0001", message }, "fallback"),
    ).toMatchObject({
      ok: false,
      code,
    });
  });
});
