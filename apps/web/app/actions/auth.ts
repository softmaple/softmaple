"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { z } from "zod/v4";

import { createClient } from "@/utils/supabase/server";
import type { AuthFormState } from "@/lib/definitions/auth";
import { AuthFormSchema } from "@/lib/definitions/auth";
import type { UsersType } from "@/types/model";
import { createUser, deleteRegisteredUser } from "@/lib/dal/user";

export async function login(state: AuthFormState, formData: FormData) {
  const validatedFields = AuthFormSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!validatedFields.success) {
    const treeified = z.treeifyError(validatedFields.error);
    return {
      errors: treeified.properties,
    };
  }

  const supabase = await createClient();

  const data = validatedFields.data;

  const { error } = await supabase.auth.signInWithPassword(data);

  if (error) {
    return { message: error?.message };
  }

  revalidatePath("/private");
  redirect("/private");
}

export async function signup(state: AuthFormState, formData: FormData) {
  const validatedFields = AuthFormSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!validatedFields.success) {
    const treeified = z.treeifyError(validatedFields.error);
    return {
      errors: treeified.properties,
    };
  }

  const supabase = await createClient();

  const data = validatedFields.data;

  const { data: user, error: retrieveUserError } = await supabase
    .from("users")
    .select<string, UsersType["Row"]>("*")
    .eq("email", data.email)
    .maybeSingle();

  if (retrieveUserError) {
    return { message: retrieveUserError?.message };
  }

  if (user) {
    return { message: "The user is existed, try another email!" };
  }

  const { data: registeredUser, error } = await supabase.auth.signUp(data);

  if (error) {
    return { message: error?.message };
  }

  if (!registeredUser || !registeredUser.user?.id) {
    return { message: "User registered failed" };
  }

  const { error: creatingUserError } = await createUser({
    id: registeredUser.user.id,
    email: data.email,
    first_name: "Hello",
    last_name: "World",
  });

  if (creatingUserError) {
    const { error: deleteUserError } = await deleteRegisteredUser(
      registeredUser.user.id,
    );

    return {
      message: [creatingUserError?.message, deleteUserError?.message]
        .filter(Boolean)
        .join("\n"),
    };
  }

  revalidatePath("/", "layout");
  redirect("/");
}

export async function logOut() {
  const supabase = await createClient();

  const { error } = await supabase.auth.signOut();

  if (error) {
    redirect("/error");
  }

  revalidatePath("/", "layout");
  redirect("/");
}
