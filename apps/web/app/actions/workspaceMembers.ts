"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { WorkspaceMembersType } from "@/types/model";
import {
  WORKSPACE_ROLE,
  type WorkspaceMemberDirectoryEntry,
} from "@/lib/workspace-roles";
import { getAuthenticatedContext } from "@/lib/actions/authenticated";
import {
  ACTION_ERROR_CODE,
  actionFailure,
  actionSuccess,
  fromDatabaseError,
  fromZodError,
  type ActionResult,
} from "@/lib/actions/result";

const workspaceIdSchema = z.number().int().positive();
const manageableRoleSchema = z.union([
  z.literal(WORKSPACE_ROLE.Editor),
  z.literal(WORKSPACE_ROLE.Viewer),
]);
const addMemberSchema = z.object({
  email: z.email("Enter a valid email address.").trim().toLowerCase(),
  role: manageableRoleSchema,
  workspaceSlug: z.string().trim().min(1),
});
const changeMemberSchema = z.object({
  memberId: z.uuid(),
  role: manageableRoleSchema,
  workspaceSlug: z.string().trim().min(1),
});
const removeMemberSchema = changeMemberSchema.omit({ role: true });

type MembershipRow = WorkspaceMembersType["Row"];

const resolveWorkspaceId = async (
  workspaceSlug: string,
): Promise<ActionResult<number>> => {
  const context = await getAuthenticatedContext();
  if (!context.ok) return context;
  const { data, error } = await context.data.supabase
    .from("workspaces")
    .select("id")
    .eq("slug", workspaceSlug)
    .maybeSingle();
  if (error !== null) {
    return fromDatabaseError(error, "Could not load the workspace.");
  }
  if (data === null) {
    return actionFailure(ACTION_ERROR_CODE.NotFound, "Workspace not found.");
  }
  return actionSuccess(data.id);
};

export const getWorkspaceMemberByUserId = async (
  workspaceId: number,
): Promise<ActionResult<Pick<MembershipRow, "role">>> => {
  const parsed = workspaceIdSchema.safeParse(workspaceId);
  if (!parsed.success) return fromZodError(parsed.error);

  const context = await getAuthenticatedContext();
  if (!context.ok) return context;
  const { data, error } = await context.data.supabase
    .from("workspace_members")
    .select("role")
    .eq("user_id", context.data.user.id)
    .eq("workspace_id", parsed.data)
    .maybeSingle();
  if (error !== null) {
    return fromDatabaseError(error, "Could not load your workspace role.");
  }
  if (data === null) {
    return actionFailure(
      ACTION_ERROR_CODE.NotFound,
      "You are not a member of this workspace.",
    );
  }
  return actionSuccess(data);
};

export const listWorkspaceMembers = async (
  workspaceId: number,
): Promise<ActionResult<WorkspaceMemberDirectoryEntry[]>> => {
  const parsed = workspaceIdSchema.safeParse(workspaceId);
  if (!parsed.success) return fromZodError(parsed.error);

  const context = await getAuthenticatedContext();
  if (!context.ok) return context;
  const { data, error } = await context.data.supabase.rpc(
    "list_workspace_members",
    { p_workspace_id: parsed.data },
  );
  if (error !== null) {
    return fromDatabaseError(error, "Could not load workspace members.");
  }
  const members = data.flatMap((member) => {
    if (
      member.role !== WORKSPACE_ROLE.Owner &&
      member.role !== WORKSPACE_ROLE.Editor &&
      member.role !== WORKSPACE_ROLE.Viewer
    ) {
      return [];
    }
    return [{ ...member, role: member.role }];
  });
  return actionSuccess(members);
};

export const addWorkspaceMember = async (
  input: unknown,
): Promise<ActionResult<{ readonly memberId: string }>> => {
  const parsed = addMemberSchema.safeParse(input);
  if (!parsed.success) return fromZodError(parsed.error);

  const context = await getAuthenticatedContext();
  if (!context.ok) return context;
  const workspaceId = await resolveWorkspaceId(parsed.data.workspaceSlug);
  if (!workspaceId.ok) return workspaceId;
  const { data, error } = await context.data.supabase.rpc(
    "add_workspace_member_by_email",
    {
      p_email: parsed.data.email,
      p_role: parsed.data.role,
      p_workspace_id: workspaceId.data,
    },
  );
  if (error !== null) {
    return fromDatabaseError(error, "Could not add the workspace member.");
  }
  revalidatePath(`/workspace/${parsed.data.workspaceSlug}`);
  return actionSuccess({ memberId: data });
};

export const setWorkspaceMemberRole = async (
  input: unknown,
): Promise<ActionResult<{ readonly memberId: string }>> => {
  const parsed = changeMemberSchema.safeParse(input);
  if (!parsed.success) return fromZodError(parsed.error);

  const context = await getAuthenticatedContext();
  if (!context.ok) return context;
  const workspaceId = await resolveWorkspaceId(parsed.data.workspaceSlug);
  if (!workspaceId.ok) return workspaceId;
  const { error } = await context.data.supabase.rpc(
    "set_workspace_member_role",
    {
      p_member_id: parsed.data.memberId,
      p_role: parsed.data.role,
      p_workspace_id: workspaceId.data,
    },
  );
  if (error !== null) {
    return fromDatabaseError(error, "Could not change the member role.");
  }
  revalidatePath(`/workspace/${parsed.data.workspaceSlug}`);
  return actionSuccess({ memberId: parsed.data.memberId });
};

export const removeWorkspaceMember = async (
  input: unknown,
): Promise<ActionResult<{ readonly memberId: string }>> => {
  const parsed = removeMemberSchema.safeParse(input);
  if (!parsed.success) return fromZodError(parsed.error);

  const context = await getAuthenticatedContext();
  if (!context.ok) return context;
  const workspaceId = await resolveWorkspaceId(parsed.data.workspaceSlug);
  if (!workspaceId.ok) return workspaceId;
  const { error } = await context.data.supabase.rpc("remove_workspace_member", {
    p_member_id: parsed.data.memberId,
    p_workspace_id: workspaceId.data,
  });
  if (error !== null) {
    return fromDatabaseError(error, "Could not remove the workspace member.");
  }
  revalidatePath(`/workspace/${parsed.data.workspaceSlug}`);
  return actionSuccess({ memberId: parsed.data.memberId });
};
