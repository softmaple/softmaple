import { createClient } from "@/utils/supabase/server";

export const getUserBy = async (filter: Record<string, any>) => {
  const supabase = await createClient();

  const query = supabase.from("users").select("*").match(filter).maybeSingle();

  return query;
};
