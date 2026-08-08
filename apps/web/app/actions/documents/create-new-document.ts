"use server";

import { redirect } from "next/navigation";
import { createDocument } from "@/app/actions/documents/documents";
import { getCurrentUser } from "@/app/actions/auth";
import { cachedGetWorkspaceBySlug } from "@/app/actions/workspaces";
import { getWorkspaceMemberByUserId } from "@/app/actions/workspaceMembers";

const DEFAULT_TITLE = "Untitled Document";

const createSlug = (title: string): string => {
  const base = title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  return `${base || "document"}-${suffix}`;
};

/** POST/server-action entry for creating a document (side-effect free GET routes). */
export const createNewDocumentAction = async (
  workspaceSlug: string,
): Promise<void> => {
  const { data: workspace, error: workspaceError } =
    await cachedGetWorkspaceBySlug(workspaceSlug);
  if (workspaceError) throw workspaceError;
  if (!workspace) {
    throw new Error("Workspace not found");
  }

  const { data: userData, error: userError } = await getCurrentUser();
  if (userError) throw userError;
  const user = userData?.user;
  if (!user) {
    throw new Error("Unauthorized");
  }

  const { data: member, error: memberError } = await getWorkspaceMemberByUserId(
    workspace.id,
  );
  if (memberError) throw memberError;
  if (!member) {
    throw new Error("Not a workspace member");
  }

  const slug = createSlug(DEFAULT_TITLE);
  const { data: created, error: createError } = await createDocument({
    title: DEFAULT_TITLE,
    slug,
    workspace_id: workspace.id,
    author_id: user.id,
    markdown_content: null,
  });

  if (createError || !created) {
    throw createError ?? new Error("Failed to create document");
  }

  redirect(`/workspace/${workspaceSlug}/doc/${created.slug}`);
};
