"use server";

import { createClient } from "@/utils/supabase/server";
import { cache } from "react";
import { redirect } from "next/navigation";
import kebabCase from "lodash/kebabCase";
import { getUserBy } from "@/app/actions/users";
import type { Workspace } from "@softmaple/db";
import { WorkspacesType } from "@/types/model";

export const getWorkspaces = async () => {
  const supabase = await createClient();

  return supabase
    .from("workspaces")
    .select<string, WorkspacesType["Row"]>("*")
    .order("created_at", { ascending: false });
};

export const cachedGetWorkspaces = cache(async () => getWorkspaces());

export const getWorkspaceBySlug = async (workspaceSlug: string) => {
  if (!workspaceSlug || typeof workspaceSlug !== "string") {
    throw new Error("Invalid workspace slug.");
  }

  const supabase = await createClient();

  return supabase
    .from("workspaces")
    .select<string, Workspace>("*")
    .eq("slug", workspaceSlug)
    .maybeSingle();
};

export const cachedGetWorkspaceBySlug = cache(async (workspaceSlug: string) =>
  getWorkspaceBySlug(workspaceSlug),
);

export const createWorkspace = async (workspace: WorkspacesType["Insert"]) => {
  const supabase = await createClient();

  return supabase
    .from("workspaces")
    .insert(workspace as any)
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

  // Owner membership is created by trg_workspaces_create_owner_member.
  redirect(`/workspace/${newWorkspace.slug}`);
};
