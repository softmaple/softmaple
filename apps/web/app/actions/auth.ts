"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createClient } from "@/utils/supabase/server";
import { loginFormSchema } from "@/modules/auth/utils/auth-form-schema";

export async function login(formData: FormData) {
  const supabase = await createClient();

  const rawData = Object.fromEntries(formData.entries());

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

  // type-casting here for convenience
  // in practice, you should validate your inputs
  const data = {
    email: formData.get("email") as string,
    password: formData.get("password") as string,
  };

  const { error } = await supabase.auth.signUp(data);

  if (error) {
    console.error(error);
    throw error;
  }

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
