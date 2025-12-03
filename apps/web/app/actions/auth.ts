"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createClient } from "@/utils/supabase/server";
import { loginFormSchema } from "@/modules/auth/utils/auth-form-schema";
import type { LoginFormSchema } from "@/modules/auth/utils/auth-form-schema";

export async function login(formData: FormData) {
  const supabase = await createClient();

  const rawEmail = formData.get("email");
  const rawPassword = formData.get("password");

  const rawData: LoginFormSchema = {
    email: rawEmail as Extract<typeof rawEmail, string>,
    password: rawPassword as Extract<typeof rawPassword, string>,
  };

  const {
    data,
    error: formError,
    success,
  } = loginFormSchema.safeParse(rawData);

  if (!success) {
    console.error("Form validation error:", formError);
    throw formError;
  }

  const { error } = await supabase.auth.signInWithPassword(data);

  if (error) {
    console.error(error);
    throw error;
  }

  revalidatePath("/dashboard", "layout");
  redirect("/dashboard");
}

export async function signup(formData: FormData) {
  const supabase = await createClient();

  // Extract and validate data
  const firstName = formData.get("firstName") as string;
  const lastName = formData.get("lastName") as string;
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;

  if (!firstName || !lastName || !email || !password) {
    return { error: "All fields are required" };
  }

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/auth/confirm`,
      data: {
        first_name: firstName,
        last_name: lastName,
        full_name: `${firstName} ${lastName}`,
      },
    },
  });

  if (error) {
    console.error("Signup error:", error);
    return { error: error.message };
  }

  // Note: The user metadata (first_name, last_name, full_name) is stored in Supabase Auth
  // The users table in the database should be populated via a trigger or separate process
  // that syncs the auth metadata with the database

  // Check if email confirmation is required
  if (data?.user && !data.session) {
    // User created but needs email confirmation
    revalidatePath("/login", "layout");
    redirect("/login?message=Check your email to confirm your account");
  } else if (data?.session) {
    // User created and auto-confirmed (for dev environments)
    revalidatePath("/dashboard", "layout");
    redirect("/dashboard");
  }

  // Fallback redirect
  revalidatePath("/", "layout");
  redirect("/");
}

export async function logout() {
  const supabase = await createClient();

  const { error } = await supabase.auth.signOut();

  if (error) {
    console.error(error);
    throw error;
  }

  revalidatePath("/", "layout");
  redirect("/");
}

export async function getCurrentUser() {
  try {
    const supabase = await createClient();

    return supabase.auth.getUser();
  } catch (error) {
    console.error("Error fetching current user:", error);
    throw error;
  }
}
