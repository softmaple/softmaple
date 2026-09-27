import { beforeEach, describe, expect, it, vi } from "vitest";
import { ACTION_ERROR_CODE, actionFailure } from "@/lib/actions/result";
import { GET } from "./route";

const actions = vi.hoisted(() => ({ loadWorkspaceWritingActivity: vi.fn() }));
vi.mock("@/app/actions/workspaceActivity", () => actions);

const request = (workspaceId: string) =>
  GET(new Request(`http://localhost/api/workspaces/${workspaceId}/activity`), {
    params: Promise.resolve({ workspaceId }),
  });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/workspaces/[workspaceId]/activity", () => {
  it("returns the snapshot without letting any cache keep it", async () => {
    const snapshot = { documents: [], observedAt: "2026-09-27T10:00:00.000Z" };
    actions.loadWorkspaceWritingActivity.mockResolvedValue({
      ok: true,
      data: snapshot,
    });

    const response = await request("42");

    expect(actions.loadWorkspaceWritingActivity).toHaveBeenCalledWith(42);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual(snapshot);
  });

  it.each([
    "0",
    "-3",
    "12abc",
    "1e3",
    "007",
  ])("hands malformed id %s to validation instead of coercing it", async (workspaceId) => {
    actions.loadWorkspaceWritingActivity.mockResolvedValue(
      actionFailure(ACTION_ERROR_CODE.Validation, "Invalid"),
    );
    const response = await request(workspaceId);
    expect(actions.loadWorkspaceWritingActivity).toHaveBeenCalledWith(
      Number.NaN,
    );
    expect(response.status).toBe(400);
  });

  it.each([
    [ACTION_ERROR_CODE.AuthenticationRequired, 401],
    [ACTION_ERROR_CODE.Forbidden, 403],
    [ACTION_ERROR_CODE.Internal, 500],
  ] as const)("maps %s to HTTP %i", async (code, status) => {
    actions.loadWorkspaceWritingActivity.mockResolvedValue(
      actionFailure(code, "Nope"),
    );
    const response = await request("42");
    expect(response.status).toBe(status);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual({ code, message: "Nope" });
  });
});
