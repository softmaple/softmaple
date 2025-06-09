import { createClient } from "@/utils/supabase/server";
import type { UsersType } from "@/types/model";

export async function createUser(userData: UsersType["Insert"]) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("users")
    .insert(userData)
    .select()
    .single();

  return { data, error };
}

export async function deleteRegisteredUser(userId: string) {
  const supabase = await createClient();

  const { error } = await supabase.auth.admin.deleteUser(userId);

  return { error };
}
