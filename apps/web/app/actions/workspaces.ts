"use server";

import { createClient } from "@/utils/supabase/server";
import { cache } from "react";
import { redirect } from "next/navigation";
import kebabCase from "lodash/kebabCase";
import { createWorkspaceMember } from "@/app/actions/workspaceMembers";
import { getUserBy } from "@/app/actions/users";

export const getWorkspaces = async () => {
  const supabase = await createClient();

  return supabase
    .from("workspaces")
    .select("*")
    .order("created_at", { ascending: false });
};

export const cachedGetWorkspaces = cache(async () => getWorkspaces());

export const getWorkspaceBySlug = async (workspaceSlug: string) => {
  const supabase = await createClient();

  return supabase
    .from("workspaces")
    .select("*")
    .eq("slug", workspaceSlug)
    .maybeSingle();
};

export const cachedGetWorkspaceBySlug = cache(async (workspaceSlug: string) =>
  getWorkspaceBySlug(workspaceSlug),
);

export const createWorkspace = async (workspace: {
  title: string;
  description?: string;
  slug: string;
}) => {
  const supabase = await createClient();

  return supabase.from("workspaces").insert(workspace).select("*").single();
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

  const nextWorkspace = {
    title,
    description: formData.get("description") as string,
    slug: kebabCase(title),
    owner_id: userId,
    created_by: userId,
    updated_by: userId,
  };

  const { data: newWorkspace, error: workspaceError } =
    await createWorkspace(nextWorkspace);

  if (workspaceError) {
    throw new Error(`Failed to create workspace: ${workspaceError.message}`);
  }

  const newWorkspaceMember = {
    workspace_id: newWorkspace.id,
    user_id: userId,
    // FIXME: Use a constant for `role` from Prisma
    role: "OWNER",
    created_by: userId,
    updated_by: userId,
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
