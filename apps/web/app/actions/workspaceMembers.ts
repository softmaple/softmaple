"use server";

import { createClient } from "@/utils/supabase/server";
import type { Database } from "@softmaple/db";

type WorkspaceMemberInsert =
  Database["public"]["Tables"]["workspace_members"]["Insert"];

export const createWorkspaceMember = async (data: WorkspaceMemberInsert) => {
  const supabase = await createClient();

  return supabase.from("workspace_members").insert(data).select("*");
};
