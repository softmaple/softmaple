"use server";

import { createClient } from "@/utils/supabase/server";
import { cache } from "react";
import { redirect } from "next/navigation";
import kebabCase from "lodash/kebabCase";
import { createWorkspaceMember } from "@/app/actions/workspaceMembers";
import { getUserBy } from "@/app/actions/users";
import { WorkspaceMemberRole } from "@softmaple/db";
import type { Workspace } from "@softmaple/db";
import { WorkspaceMembersType, WorkspacesType } from "@/types/model";
import { serverCrud } from "@/utils/crud";

export const getWorkspaces = async () => {
  return serverCrud.workspaces().getAll({
    orderBy: { column: "created_at", ascending: false },
  });
};

export const cachedGetWorkspaces = cache(async () => getWorkspaces());

export const getWorkspaceBySlug = async (workspaceSlug: string) => {
  if (!workspaceSlug || typeof workspaceSlug !== "string") {
    throw new Error("Invalid workspace slug.");
  }

  return serverCrud.workspaces().getOneBy({ slug: workspaceSlug });
};

export const cachedGetWorkspaceBySlug = cache(async (workspaceSlug: string) =>
  getWorkspaceBySlug(workspaceSlug),
);

export const createWorkspace = async (workspace: WorkspacesType["Insert"]) => {
  const supabase = await createClient();

  return supabase
    .from("workspaces")
    .insert(workspace)
    .select<string, WorkspacesType["Row"]>("*")
    .single();
};

export const handleCreateWorkspaceFormData = async (formData: FormData) => {
  const title = formData.get("title");

  if (!title || typeof title !== "string" || title.trim() === "") {
    throw new Error("Workspace title is required.");
  }

  const supabase = await createClient();
  const { data, error: getUserError } = await supabase.auth.getUser();

  if (!data.user || getUserError) {
    throw new Error("User not authenticated.");
  }

  const { data: user, error: userError } = await getUserBy({
    id: data.user.id,
  });

  if (!user || userError) {
    throw new Error(`Failed to fetch user: ${userError?.message}`);
  }

  const userId = user.id;

  const nextWorkspace: WorkspacesType["Insert"] = {
    title,
    description: formData.get("description") as string,
    slug: kebabCase(title),
    owner_id: userId,
  };

  const { data: newWorkspace, error: workspaceError } =
    await createWorkspace(nextWorkspace);

  if (workspaceError) {
    throw new Error(`Failed to create workspace: ${workspaceError.message}`);
  }

  const newWorkspaceMember: WorkspaceMembersType["Insert"] = {
    workspace_id: newWorkspace.id,
    user_id: userId,
    role: WorkspaceMemberRole["OWNER"],
  };

  const { data: memberData, error: memberError } =
    await createWorkspaceMember(newWorkspaceMember);

  if (memberError) {
    throw new Error(
      `Failed to create workspace member: ${memberError.message}`,
    );
  }

  redirect(`/workspace/${newWorkspace.slug}`);
};
