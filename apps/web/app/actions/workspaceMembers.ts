"use server";

import { createClient } from "@/utils/supabase/server";
import { WorkspaceMembersType } from "@/types/model";
import { getCurrentUser } from "@/app/actions/auth";

export const createWorkspaceMember = async (
  data: WorkspaceMembersType["Insert"],
) => {
  const supabase = await createClient();

  return supabase
    .from("workspace_members")
    .insert(data)
    .select<string, WorkspaceMembersType["Row"]>("*");
};

export const getWorkspaceMemberByUserId = async (workspaceId: number) => {
  try {
    const supabase = await createClient();

    const { data: userData, error: userError } = await getCurrentUser();

    if (userError) {
      console.error("Error fetching user data:", userError);
      throw userError;
    }

    if (!userData?.user?.id) {
      throw new Error("User ID not found in user data.");
    }

    const userId = userData.user.id;

    const queryBuilder = supabase
      .from("workspace_members")
      .select<
        keyof Pick<WorkspaceMembersType["Row"], "role">,
        Pick<WorkspaceMembersType["Row"], "role">
      >("role")
      .eq("user_id", userId)
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    return queryBuilder;
  } catch (error) {
    console.error("Error fetching workspace member by user ID:", error);
    throw error;
  }
};
