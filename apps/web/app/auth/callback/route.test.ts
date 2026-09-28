// @vitest-environment node
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const { exchangeCodeForSession, getUser } = vi.hoisted(() => ({
  exchangeCodeForSession: vi.fn(),
  getUser: vi.fn(),
}));
vi.mock("@/utils/supabase/server", () => ({
  createClient: async () => ({ auth: { exchangeCodeForSession, getUser } }),
}));

const redirectFor = async (query: string): Promise<string | null> =>
  (
    await GET(new NextRequest(`https://app.test/auth/callback${query}`))
  ).headers.get("location");

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  exchangeCodeForSession.mockResolvedValue({ error: null });
  getUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("auth callback", () => {
  const recovery = "?type=recovery&next=/reset-password/update";

  it("offers a new reset link when Supabase returns no code", async () => {
    expect(await redirectFor(recovery)).toBe(
      "https://app.test/reset-password?error=reset_link_invalid",
    );
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it("says when a reset link was opened in another browser", async () => {
    exchangeCodeForSession.mockResolvedValue({
      error: {
        code: "pkce_code_verifier_not_found",
        message: "PKCE code verifier not found in storage.",
      },
    });
    expect(await redirectFor(`${recovery}&code=abc`)).toBe(
      "https://app.test/reset-password?error=reset_link_other_browser",
    );
  });

  it("keeps Supabase's own wording out of the URL", async () => {
    exchangeCodeForSession.mockResolvedValue({
      error: { code: "flow_state_expired", message: "Flow state has expired" },
    });
    const location = await redirectFor(`${recovery}&code=abc`);
    expect(location).toBe(
      "https://app.test/reset-password?error=reset_link_invalid",
    );
    expect(location).not.toMatch(/expired/i);
  });

  it("opens the new password form after a good reset link", async () => {
    expect(await redirectFor(`${recovery}&code=abc`)).toBe(
      "https://app.test/reset-password/update",
    );
    expect(exchangeCodeForSession).toHaveBeenCalledWith("abc");
    expect(getUser).not.toHaveBeenCalled();
  });

  it("sends other failed sign-ins to login with a code", async () => {
    expect(await redirectFor("?next=/dashboard")).toBe(
      "https://app.test/login?error=sign_in_failed",
    );
    exchangeCodeForSession.mockResolvedValue({
      error: { code: "bad_code_verifier", message: "invalid" },
    });
    expect(await redirectFor("?code=abc&next=/dashboard")).toBe(
      "https://app.test/login?error=sign_in_failed",
    );
    exchangeCodeForSession.mockResolvedValue({ error: null });
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    expect(await redirectFor("?code=abc&next=/dashboard")).toBe(
      "https://app.test/login?error=sign_in_failed",
    );
  });

  it("continues signed-in visitors to a safe next path", async () => {
    expect(await redirectFor("?code=abc&next=/dashboard")).toBe(
      "https://app.test/dashboard",
    );
    expect(await redirectFor("?code=abc&next=//evil.test")).toBe(
      "https://app.test/",
    );
  });
});
