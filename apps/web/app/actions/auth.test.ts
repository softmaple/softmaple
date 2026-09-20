import { beforeEach, describe, expect, it, vi } from "vitest";

const { signUp, signInWithPassword, revalidatePath } = vi.hoisted(() => ({
  signUp: vi.fn(),
  signInWithPassword: vi.fn(),
  revalidatePath: vi.fn(),
}));
vi.mock("@/utils/supabase/server", () => ({
  createClient: vi.fn(async () => ({ auth: { signUp, signInWithPassword } })),
}));
vi.mock("next/cache", () => ({ revalidatePath }));

import { login, signup } from "./auth";

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
