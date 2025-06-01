"use server";

import { createClient } from "@/utils/supabase/server";
import { Table } from "@/types/model";

export const createWorkspaceMember = async (
  data: Table<"workspace_members">["Insert"],
) => {
  const supabase = await createClient();

  return supabase
    .from("workspace_members")
    .insert(data)
    .select<string, Table<"workspace_members">["Row"]>("*");
};
