// @vitest-environment node
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const { redirect, verifyOtp } = vi.hoisted(() => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
  verifyOtp: vi.fn(),
}));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/utils/supabase/server", () => ({
  createClient: async () => ({ auth: { verifyOtp } }),
}));

const confirm = (query: string) =>
  GET(new NextRequest(`https://app.test/auth/confirm${query}`));
const redirectFor = async (query: string): Promise<string | null> =>
  (await confirm(query)).headers.get("location");

beforeEach(() => {
  vi.clearAllMocks();
  verifyOtp.mockResolvedValue({ error: null });
});

describe("auth confirm", () => {
  it("verifies the token in any browser and continues to next", async () => {
    await expect(
      confirm("?token_hash=hash&type=recovery&next=/reset-password/update"),
    ).rejects.toThrow("redirect:/reset-password/update");
    expect(verifyOtp).toHaveBeenCalledWith({
      token_hash: "hash",
      type: "recovery",
    });
  });

  it("offers a new reset link instead of an error body", async () => {
    expect(await redirectFor("?type=recovery")).toBe(
      "https://app.test/reset-password?error=reset_link_invalid",
    );
    expect(verifyOtp).not.toHaveBeenCalled();

    verifyOtp.mockResolvedValue({
      error: { code: "otp_expired", message: "Email link is invalid" },
    });
    expect(await redirectFor("?token_hash=hash&type=recovery&next=/x")).toBe(
      "https://app.test/reset-password?error=reset_link_invalid",
    );
  });

  it("sends other broken links to login with a code", async () => {
    expect(await redirectFor("?token_hash=hash")).toBe(
      "https://app.test/login?error=link_invalid",
    );
    expect(await redirectFor("?token_hash=hash&type=bogus")).toBe(
      "https://app.test/login?error=link_invalid",
    );
    verifyOtp.mockResolvedValue({
      error: { code: "otp_expired", message: "Email link is invalid" },
    });
    expect(await redirectFor("?token_hash=hash&type=email")).toBe(
      "https://app.test/login?error=link_invalid",
    );
  });

  it("defaults a reset link to the new password form", async () => {
    await expect(confirm("?token_hash=hash&type=recovery")).rejects.toThrow(
      "redirect:/reset-password/update",
    );
    await expect(confirm("?token_hash=hash&type=email")).rejects.toThrow(
      /^redirect:\/$/,
    );
  });

  it("never follows an unsafe next", async () => {
    await expect(
      confirm("?token_hash=hash&type=email&next=https://evil.test"),
    ).rejects.toThrow(/^redirect:\/$/);
  });
});
