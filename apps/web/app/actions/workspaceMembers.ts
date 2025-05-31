"use server";

import { createClient } from "@/utils/supabase/server";

export const createWorkspaceMember = async (data: any) => {
  const supabase = await createClient();

  return supabase.from("workspace_members").insert(data).select("*");
};
