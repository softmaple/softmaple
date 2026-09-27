import { beforeEach, describe, expect, it, vi } from "vitest";
import { ACTION_ERROR_CODE, actionFailure } from "@/lib/actions/result";
import { WRITING_ACTIVITY_WINDOW_SECONDS } from "@/modules/workspaces/writing-activity";
import { loadWorkspaceWritingActivity } from "./workspaceActivity";

const auth = vi.hoisted(() => ({ getAuthenticatedContext: vi.fn() }));
vi.mock("@/lib/actions/authenticated", () => auth);

const rpc = vi.fn();

const signedIn = () =>
  auth.getAuthenticatedContext.mockResolvedValue({
    ok: true,
    data: { supabase: { rpc }, user: { id: "viewer" } },
  });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("loadWorkspaceWritingActivity", () => {
  it.each([
    0,
    -1,
    1.5,
    Number.NaN,
    2_147_483_648,
  ])("rejects workspace id %s before any lookup", async (workspaceId) => {
    const result = await loadWorkspaceWritingActivity(workspaceId);
    expect(result).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(auth.getAuthenticatedContext).not.toHaveBeenCalled();
  });

  it("requires a signed-in member", async () => {
    auth.getAuthenticatedContext.mockResolvedValue(
      actionFailure(
        ACTION_ERROR_CODE.AuthenticationRequired,
        "Sign in to continue.",
      ),
    );
    await expect(loadWorkspaceWritingActivity(7)).resolves.toMatchObject({
      ok: false,
      code: "AUTHENTICATION_REQUIRED",
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("maps a membership denial from the database", async () => {
    signedIn();
    rpc.mockResolvedValue({
      data: null,
      error: { code: "42501", message: "workspace_access_denied" },
    });
    await expect(loadWorkspaceWritingActivity(7)).resolves.toMatchObject({
      ok: false,
      code: "FORBIDDEN",
    });
  });

  it("asks for the activity window and ranks rows for the viewer", async () => {
    signedIn();
    rpc.mockResolvedValue({
      data: [
        {
          avatar_src: null,
          document_id: "solo",
          document_slug: "solo-notes",
          document_title: "Solo notes",
          full_name: "Adam",
          last_written_at: "2026-09-27T10:04:00+00:00",
          user_id: "viewer",
        },
        {
          avatar_src: "/mia.jpg",
          document_id: "shared",
          document_slug: "a-brighter-tomorrow",
          document_title: "A brighter tomorrow",
          full_name: "Mia",
          last_written_at: "2026-09-27T10:01:00+00:00",
          user_id: "mia",
        },
      ],
      error: null,
    });

    const result = await loadWorkspaceWritingActivity(7);

    expect(rpc).toHaveBeenCalledWith("list_workspace_writing_activity", {
      p_window_seconds: WRITING_ACTIVITY_WINDOW_SECONDS,
      p_workspace_id: 7,
    });
    if (!result.ok) throw new Error(result.message);
    expect(result.data.documents.map((document) => document.slug)).toEqual([
      "a-brighter-tomorrow",
      "solo-notes",
    ]);
    expect(result.data.documents[0]?.writers).toEqual([
      {
        avatarSrc: "/mia.jpg",
        fullName: "Mia",
        isViewer: false,
        lastWrittenAt: "2026-09-27T10:01:00+00:00",
        userId: "mia",
      },
    ]);
    expect(result.data.documents[1]?.writers[0]?.isViewer).toBe(true);
    expect(Number.isNaN(Date.parse(result.data.observedAt))).toBe(false);
  });
});
