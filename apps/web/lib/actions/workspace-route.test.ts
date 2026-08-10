import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ACTION_ERROR_CODE, actionFailure, actionSuccess } from "./result";

const notFound = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
);
const redirect = vi.hoisted(() =>
  vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
);

vi.mock("next/navigation", () => ({
  notFound,
  redirect,
}));

describe("requireWorkspaceRouteData", () => {
  const context = {
    loginNext: "/workspace/acme/settings",
    operation: "list_workspace_members",
    route: "/workspace/[workspaceSlug]/settings",
    workspaceSlug: "acme",
  } as const;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns data for successful results", async () => {
    const { requireWorkspaceRouteData } = await import("./workspace-route");
    expect(
      requireWorkspaceRouteData(actionSuccess({ role: "OWNER" }), context),
    ).toEqual({ role: "OWNER" });
    expect(notFound).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("maps NOT_FOUND to notFound without logging", async () => {
    const { requireWorkspaceRouteData } = await import("./workspace-route");
    expect(() =>
      requireWorkspaceRouteData(
        actionFailure(ACTION_ERROR_CODE.NotFound, "Workspace not found."),
        context,
      ),
    ).toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalledOnce();
    expect(console.error).not.toHaveBeenCalled();
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("maps FORBIDDEN to notFound and warns", async () => {
    const { requireWorkspaceRouteData } = await import("./workspace-route");
    expect(() =>
      requireWorkspaceRouteData(
        actionFailure(
          ACTION_ERROR_CODE.Forbidden,
          "You do not have access to this workspace.",
        ),
        context,
      ),
    ).toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalledOnce();
    expect(console.warn).toHaveBeenCalledWith(
      "[workspace-route]",
      expect.objectContaining({
        code: ACTION_ERROR_CODE.Forbidden,
        operation: "list_workspace_members",
        workspaceSlug: "acme",
      }),
    );
  });

  it("maps AUTHENTICATION_REQUIRED to a login redirect with next", async () => {
    const { requireWorkspaceRouteData } = await import("./workspace-route");
    expect(() =>
      requireWorkspaceRouteData(
        actionFailure(
          ACTION_ERROR_CODE.AuthenticationRequired,
          "Sign in to continue.",
        ),
        context,
      ),
    ).toThrow("NEXT_REDIRECT:/login?next=%2Fworkspace%2Facme%2Fsettings");
    expect(redirect).toHaveBeenCalledWith(
      "/login?next=%2Fworkspace%2Facme%2Fsettings",
    );
    expect(notFound).not.toHaveBeenCalled();
  });

  it.each([
    [ACTION_ERROR_CODE.Internal, "Could not load workspace members."],
    [ACTION_ERROR_CODE.Conflict, "That change conflicts with existing data."],
    [ACTION_ERROR_CODE.Validation, "Check the highlighted fields."],
    [ACTION_ERROR_CODE.Storage, "Storage failed."],
  ] as const)("maps %s to a thrown server error instead of notFound", async (code, message) => {
    const { requireWorkspaceRouteData } = await import("./workspace-route");
    expect(() =>
      requireWorkspaceRouteData(actionFailure(code, message), context),
    ).toThrow(`${context.operation} failed (${code}): ${message}`);
    expect(notFound).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(
      "[workspace-route]",
      expect.objectContaining({
        code,
        operation: context.operation,
        workspaceSlug: context.workspaceSlug,
      }),
    );
  });
});
