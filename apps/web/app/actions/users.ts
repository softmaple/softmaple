import { createClient } from "@/utils/supabase/server";
import type { User } from "@softmaple/db";

export const getUserBy = async (filter: Record<string, any>) => {
  const supabase = await createClient();

  const query = supabase
    .from("users")
    .select<string, User>("*")
    .match(filter)
    .maybeSingle();

  return query;
};
