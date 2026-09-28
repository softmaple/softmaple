import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  signUp,
  signInWithPassword,
  getUser,
  resetPasswordForEmail,
  revalidatePath,
} = vi.hoisted(() => ({
  signUp: vi.fn(),
  signInWithPassword: vi.fn(),
  getUser: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  revalidatePath: vi.fn(),
}));
vi.mock("@/utils/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { signUp, signInWithPassword, getUser, resetPasswordForEmail },
  })),
}));
vi.mock("next/cache", () => ({ revalidatePath }));

import { login, resetPassword, sendPasswordResetLink, signup } from "./auth";

const form = (values: Record<string, string>) => {
  const data = new FormData();
  Object.entries(values).forEach(([key, value]) => data.set(key, value));
  return data;
};

const signupForm = (values: Record<string, string> = {}) =>
  form({
    firstName: " Ada ",
    lastName: " Lovelace ",
    email: "ada@example.invalid",
    password: "password123",
    confirmPassword: values.password ?? "password123",
    ...values,
  });

beforeEach(() => vi.resetAllMocks());

describe("registration with original profile fields", () => {
  it("submits trimmed profile metadata and preserves email verification", async () => {
    signUp.mockResolvedValue({ data: { session: null }, error: null });
    const result = await signup(
      null,
      signupForm({ email: "Ada@Example.invalid", password: "password123" }),
    );
    expect(signUp).toHaveBeenCalledWith({
      email: "ada@example.invalid",
      password: "password123",
      options: {
        data: {
          first_name: "Ada",
          full_name: "Ada Lovelace",
          last_name: "Lovelace",
        },
        emailRedirectTo: expect.stringMatching(
          /\/auth\/confirm\?next=\/dashboard$/,
        ),
      },
    });
    expect(result).toMatchObject({
      ok: true,
      data: {
        message: expect.stringContaining("Check your email"),
        redirectTo: expect.stringMatching(/^\/login\?message=/),
      },
    });
  });

  it.each([
    "abc1234",
    "abcdefgh",
    "12345678",
    `a1${"x".repeat(127)}`,
  ])("rejects invalid password strength before contacting auth: %s", async (password) => {
    const result = await signup(
      null,
      signupForm({ email: "ada@example.invalid", password }),
    );
    expect(result).toMatchObject({
      ok: false,
      fieldErrors: { password: expect.any(Array) },
    });
    expect(signUp).not.toHaveBeenCalled();
  });

  it.each([
    ["firstName", " ", "First name is required."],
    ["lastName", " ", "Last name is required."],
    ["confirmPassword", "different123", "Passwords do not match."],
  ])("rejects invalid %s before contacting auth", async (field, value, message) => {
    const result = await signup(null, signupForm({ [field]: value }));
    expect(result).toMatchObject({
      ok: false,
      fieldErrors: { [field]: [message] },
    });
    expect(signUp).not.toHaveBeenCalled();
  });

  it("preserves immediate-session redirects", async () => {
    signUp.mockResolvedValue({ data: { session: {} }, error: null });
    expect(
      await signup(
        null,
        signupForm({ email: "ada@example.invalid", password: "password123" }),
      ),
    ).toEqual({ ok: true, data: { redirectTo: "/dashboard" } });
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it.each([
    ["user_already_exists", "An account with that email already exists."],
    ["unexpected_failure", "Could not create your account. Try again."],
  ])("preserves %s errors", async (code, message) => {
    signUp.mockResolvedValue({ data: { session: null }, error: { code } });
    expect(
      await signup(
        null,
        signupForm({ email: "ada@example.invalid", password: "password123" }),
      ),
    ).toMatchObject({ ok: false, message });
  });
});

describe("existing email login", () => {
  it.each([
    ["/settings/account", "/settings/account"],
    ["https://example.invalid", "/"],
  ])("preserves safe next redirects: %s", async (next, expected) => {
    signInWithPassword.mockResolvedValue({ error: null });
    expect(
      await login(
        null,
        form({ email: "ada@example.invalid", password: "password123", next }),
      ),
    ).toEqual({ ok: true, data: { redirectTo: expected } });
  });

  it("preserves invalid-credentials feedback", async () => {
    signInWithPassword.mockResolvedValue({
      error: { code: "invalid_credentials" },
    });
    expect(
      await login(
        null,
        form({ email: "ada@example.invalid", password: "wrong" }),
      ),
    ).toMatchObject({
      ok: false,
      message: "The email or password is incorrect.",
    });
  });
});

describe("forgot password", () => {
  it("sends the recovery link and returns to log in", async () => {
    resetPasswordForEmail.mockResolvedValue({ error: null });
    const message =
      "If an account uses that email, a password reset link is on its way.";
    expect(
      await resetPassword(null, form({ email: "Ada@Example.invalid" })),
    ).toEqual({
      ok: true,
      data: {
        message,
        redirectTo: `/login?message=${encodeURIComponent(message)}`,
      },
    });
    expect(resetPasswordForEmail).toHaveBeenCalledWith("ada@example.invalid", {
      redirectTo: expect.stringMatching(
        /\/auth\/callback\?type=recovery&next=\/reset-password\/update$/,
      ),
    });
  });

  it("stays on the form when the link cannot be sent", async () => {
    resetPasswordForEmail.mockResolvedValue({ error: { message: "down" } });
    expect(
      await resetPassword(null, form({ email: "ada@example.invalid" })),
    ).toMatchObject({
      ok: false,
      message: "Could not send the reset link. Try again.",
    });
  });
});

describe("account password reset", () => {
  const signedIn = (email: string | undefined) =>
    getUser.mockResolvedValue({ data: { user: { email } }, error: null });

  it("emails the session's own address with the recovery callback", async () => {
    signedIn("ada@example.invalid");
    resetPasswordForEmail.mockResolvedValue({ error: null });
    expect(await sendPasswordResetLink()).toEqual({
      ok: true,
      data: { message: "We sent a reset link to ada@example.invalid." },
    });
    expect(resetPasswordForEmail).toHaveBeenCalledWith("ada@example.invalid", {
      redirectTo: expect.stringMatching(
        /\/auth\/callback\?type=recovery&next=\/reset-password\/update$/,
      ),
    });
  });

  it.each([
    ["no session", { data: { user: null }, error: { message: "missing" } }],
    ["no email", { data: { user: { email: undefined } }, error: null }],
  ])("asks to log in when there is %s", async (_case, response) => {
    getUser.mockResolvedValue(response);
    expect(await sendPasswordResetLink()).toMatchObject({
      ok: false,
      code: "AUTHENTICATION_REQUIRED",
      message: "Log in to continue.",
    });
    expect(resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it.each([
    [
      "over_email_send_rate_limit",
      "A reset link was sent recently. Check your inbox, or try again in a minute.",
    ],
    [
      "over_request_rate_limit",
      "A reset link was sent recently. Check your inbox, or try again in a minute.",
    ],
    ["unexpected_failure", "Could not send the reset link. Try again."],
  ])("explains %s errors", async (code, message) => {
    signedIn("ada@example.invalid");
    resetPasswordForEmail.mockResolvedValue({ error: { code } });
    expect(await sendPasswordResetLink()).toMatchObject({ ok: false, message });
  });
});
