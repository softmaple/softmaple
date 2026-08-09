"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/utils/supabase/server";
import type { User } from "@supabase/supabase-js";
import { sanitizeRedirectUrl } from "@/utils/auth/sanitize-redirect";
import {
  ACTION_ERROR_CODE,
  actionFailure,
  actionSuccess,
  fromZodError,
  type ActionResult,
} from "@/lib/actions/result";

export type AuthActionData = {
  readonly message?: string;
  readonly redirectTo?: string;
};

const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters.")
  .max(128)
  .regex(/[a-zA-Z]/, "Password must contain a letter.")
  .regex(/[0-9]/, "Password must contain a number.");
const loginSchema = z.object({
  email: z.email("Enter a valid email address.").trim().toLowerCase(),
  password: z.string().min(1, "Password is required."),
});
const signupSchema = z
  .object({
    confirmPassword: z.string(),
    email: z.email("Enter a valid email address.").trim().toLowerCase(),
    firstName: z.string().trim().min(1, "First name is required.").max(60),
    lastName: z.string().trim().min(1, "Last name is required.").max(60),
    password: passwordSchema,
  })
  .refine((value) => value.password === value.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  });
const resetSchema = z.object({
  email: z.email("Enter a valid email address.").trim().toLowerCase(),
});
const updatePasswordSchema = z
  .object({
    confirmPassword: z.string(),
    password: passwordSchema,
  })
  .refine((value) => value.password === value.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  });

const appOrigin = (): string => {
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  if (configured === undefined) return "http://localhost:3000";
  return new URL(configured).origin;
};

const authFailure = (message: string): ActionResult<never> =>
  actionFailure(ACTION_ERROR_CODE.AuthenticationRequired, message);

export const login = async (
  _previousState: ActionResult<AuthActionData> | null,
  formData: FormData,
): Promise<ActionResult<AuthActionData>> => {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return fromZodError(parsed.error);

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error !== null) {
    return authFailure("The email or password is incorrect.");
  }

  const rawNext = formData.get("next");
  const redirectTo =
    typeof rawNext === "string" && rawNext.length > 0
      ? sanitizeRedirectUrl(rawNext)
      : "/dashboard";
  revalidatePath("/", "layout");
  return actionSuccess({ redirectTo });
};

export const signup = async (
  _previousState: ActionResult<AuthActionData> | null,
  formData: FormData,
): Promise<ActionResult<AuthActionData>> => {
  const parsed = signupSchema.safeParse({
    confirmPassword: formData.get("confirmPassword"),
    email: formData.get("email"),
    firstName: formData.get("firstName"),
    lastName: formData.get("lastName"),
    password: formData.get("password"),
  });
  if (!parsed.success) return fromZodError(parsed.error);

  const supabase = await createClient();
  const fullName = `${parsed.data.firstName} ${parsed.data.lastName}`;
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: {
        first_name: parsed.data.firstName,
        full_name: fullName,
        last_name: parsed.data.lastName,
      },
      emailRedirectTo: `${appOrigin()}/auth/confirm?next=/dashboard`,
    },
  });
  if (error !== null) {
    const code =
      error.code === "user_already_exists"
        ? ACTION_ERROR_CODE.Conflict
        : ACTION_ERROR_CODE.Internal;
    return actionFailure(
      code,
      code === ACTION_ERROR_CODE.Conflict
        ? "An account with that email already exists."
        : "Could not create your account. Try again.",
    );
  }
  if (data.session !== null) {
    revalidatePath("/", "layout");
    return actionSuccess({ redirectTo: "/dashboard" });
  }
  return actionSuccess({
    message: "Check your email to confirm your account, then sign in.",
    redirectTo:
      "/login?message=Check%20your%20email%20to%20confirm%20your%20account",
  });
};

export const resetPassword = async (
  _previousState: ActionResult<AuthActionData> | null,
  formData: FormData,
): Promise<ActionResult<AuthActionData>> => {
  const parsed = resetSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) return fromZodError(parsed.error);

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(
    parsed.data.email,
    {
      redirectTo: `${appOrigin()}/auth/callback?type=recovery&next=/reset-password/update`,
    },
  );
  if (error !== null) {
    return actionFailure(
      ACTION_ERROR_CODE.Internal,
      "Could not send the reset link. Try again.",
    );
  }
  return actionSuccess({
    message:
      "If an account uses that email, a password reset link is on its way.",
  });
};

export const updatePassword = async (
  _previousState: ActionResult<AuthActionData> | null,
  formData: FormData,
): Promise<ActionResult<AuthActionData>> => {
  const parsed = updatePasswordSchema.safeParse({
    confirmPassword: formData.get("confirmPassword"),
    password: formData.get("password"),
  });
  if (!parsed.success) return fromZodError(parsed.error);

  const supabase = await createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError !== null || userData.user === null) {
    return authFailure("This password reset link is invalid or has expired.");
  }
  const { error } = await supabase.auth.updateUser({
    password: parsed.data.password,
  });
  if (error !== null) {
    return actionFailure(
      ACTION_ERROR_CODE.Internal,
      "Could not update your password. Request a new reset link.",
    );
  }
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  return actionSuccess({
    redirectTo:
      "/login?message=Password%20updated.%20Sign%20in%20with%20your%20new%20password.",
  });
};

export const logout = async (): Promise<ActionResult<AuthActionData>> => {
  const supabase = await createClient();
  const { error } = await supabase.auth.signOut();
  if (error !== null) {
    return actionFailure(
      ACTION_ERROR_CODE.Internal,
      "Could not sign out. Try again.",
    );
  }
  revalidatePath("/", "layout");
  return actionSuccess({ redirectTo: "/" });
};

export const getCurrentUser = async (): Promise<ActionResult<User>> => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error !== null || data.user === null) {
    return authFailure("Sign in to continue.");
  }
  return actionSuccess(data.user);
};
