"use server";

import { cache } from "react";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { WorkspacesType } from "@/types/model";
import { createStableSlug } from "@/lib/slug";
import { getAuthenticatedContext } from "@/lib/actions/authenticated";
import {
  ACTION_ERROR_CODE,
  actionFailure,
  actionSuccess,
  fromDatabaseError,
  fromZodError,
  type ActionResult,
} from "@/lib/actions/result";

const workspaceSchema = z.object({
  description: z.string().trim().max(500).optional().default(""),
  title: z.string().trim().min(1, "Workspace name is required.").max(80),
});

const workspaceMutationSchema = workspaceSchema.extend({
  workspaceSlug: z.string().trim().min(1),
});

const deleteWorkspaceSchema = z.object({
  confirmation: z.string(),
  workspaceSlug: z.string().trim().min(1),
});

type WorkspaceRow = WorkspacesType["Row"];

export type WorkspaceSummary = WorkspaceRow & {
  readonly documentCount: number;
  readonly lastEditedAt: string | null;
  readonly memberCount: number;
};

const readWorkspaceBySlug = async (
  workspaceSlug: string,
): Promise<ActionResult<WorkspaceRow>> => {
  const context = await getAuthenticatedContext();
  if (!context.ok) return context;

  const { data, error } = await context.data.supabase
    .from("workspaces")
    .select("*")
    .eq("slug", workspaceSlug)
    .maybeSingle();
  if (error !== null) {
    return fromDatabaseError(error, "Could not load the workspace.");
  }
  if (data === null) {
    return actionFailure(ACTION_ERROR_CODE.NotFound, "Workspace not found.");
  }
  return actionSuccess(data);
};

export const getWorkspaces = async (): Promise<
  ActionResult<WorkspaceSummary[]>
> => {
  const context = await getAuthenticatedContext();
  if (!context.ok) return context;

  const { data, error } = await context.data.supabase
    .from("workspaces")
    .select("*, documents(count), workspace_members(count)")
    .order("updated_at", { ascending: false, nullsFirst: false });
  if (error !== null) {
    return fromDatabaseError(error, "Could not load your workspaces.");
  }

  const summaries = data.map(
    ({ documents, workspace_members, ...workspace }) => ({
      ...workspace,
      documentCount: documents[0]?.count ?? 0,
      lastEditedAt: workspace.updated_at,
      memberCount: workspace_members[0]?.count ?? 0,
    }),
  );
  return actionSuccess(summaries);
};

export const cachedGetWorkspaces = cache(getWorkspaces);

export const getWorkspaceBySlug = async (
  workspaceSlug: string,
): Promise<ActionResult<WorkspaceRow>> => {
  const parsed = z.string().trim().min(1).safeParse(workspaceSlug);
  if (!parsed.success) return fromZodError(parsed.error);
  return readWorkspaceBySlug(parsed.data);
};

export const cachedGetWorkspaceBySlug = cache(getWorkspaceBySlug);

export const createWorkspace = async (
  _previousState: ActionResult<WorkspaceRow> | null,
  formData: FormData,
): Promise<ActionResult<WorkspaceRow>> => {
  const parsed = workspaceSchema.safeParse({
    description: formData.get("description"),
    title: formData.get("title"),
  });
  if (!parsed.success) return fromZodError(parsed.error);

  const context = await getAuthenticatedContext();
  if (!context.ok) return context;

  const { data, error } = await context.data.supabase
    .from("workspaces")
    .insert({
      description: parsed.data.description || null,
      owner_id: context.data.user.id,
      slug: createStableSlug(parsed.data.title),
      title: parsed.data.title,
    })
    .select("*")
    .single();
  if (error !== null) {
    return fromDatabaseError(error, "Could not create the workspace.");
  }

  revalidatePath("/dashboard");
  return actionSuccess(data);
};

export const updateWorkspace = async (
  input: unknown,
): Promise<ActionResult<WorkspaceRow>> => {
  const parsed = workspaceMutationSchema.safeParse(input);
  if (!parsed.success) return fromZodError(parsed.error);

  const workspace = await readWorkspaceBySlug(parsed.data.workspaceSlug);
  if (!workspace.ok) return workspace;
  const context = await getAuthenticatedContext();
  if (!context.ok) return context;

  const { data, error } = await context.data.supabase
    .from("workspaces")
    .update({
      description: parsed.data.description || null,
      title: parsed.data.title,
    })
    .eq("id", workspace.data.id)
    .select("*")
    .single();
  if (error !== null) {
    return fromDatabaseError(error, "Could not update the workspace.");
  }

  revalidatePath(`/workspace/${workspace.data.slug}`);
  revalidatePath("/dashboard");
  return actionSuccess(data);
};

export const deleteWorkspace = async (
  input: unknown,
): Promise<ActionResult<{ readonly slug: string }>> => {
  const parsed = deleteWorkspaceSchema.safeParse(input);
  if (!parsed.success) return fromZodError(parsed.error);

  const workspace = await readWorkspaceBySlug(parsed.data.workspaceSlug);
  if (!workspace.ok) return workspace;
  if (parsed.data.confirmation !== workspace.data.title) {
    return actionFailure(
      ACTION_ERROR_CODE.Validation,
      "Enter the workspace name exactly to confirm deletion.",
      { confirmation: ["The workspace name does not match."] },
    );
  }

  const context = await getAuthenticatedContext();
  if (!context.ok) return context;
  const { error } = await context.data.supabase
    .from("workspaces")
    .delete()
    .eq("id", workspace.data.id);
  if (error !== null) {
    return fromDatabaseError(error, "Could not delete the workspace.");
  }

  revalidatePath("/dashboard");
  return actionSuccess({ slug: workspace.data.slug });
};
