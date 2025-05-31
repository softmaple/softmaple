"use server";

import { createClient } from "@/utils/supabase/server";
import type { Prisma } from "@softmaple/db";

export const createWorkspaceMember = async (
  data: Prisma.WorkspaceMemberUncheckedCreateInput,
) => {
  const supabase = await createClient();

  return supabase.from("workspace_members").insert(data).select("*");
};
