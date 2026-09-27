"use server";

import { z } from "zod";
import { getAuthenticatedContext } from "@/lib/actions/authenticated";
import {
  actionSuccess,
  fromDatabaseError,
  fromZodError,
  type ActionResult,
} from "@/lib/actions/result";
import {
  groupWritingActivity,
  WRITING_ACTIVITY_WINDOW_SECONDS,
  type WritingActivitySnapshot,
} from "@/modules/workspaces/writing-activity";

// Workspace ids are Postgres INTEGERs; reject overflow before the database.
const workspaceIdSchema = z.number().int().positive().max(2_147_483_647);

/**
 * Who is writing where in a workspace right now, ranked for the viewer. The
 * database authorizes membership and reads durable history, so the answer
 * does not depend on which collaboration runtime serves each document.
 */
export const loadWorkspaceWritingActivity = async (
  workspaceId: number,
): Promise<ActionResult<WritingActivitySnapshot>> => {
  const parsed = workspaceIdSchema.safeParse(workspaceId);
  if (!parsed.success) return fromZodError(parsed.error);

  const context = await getAuthenticatedContext();
  if (!context.ok) return context;
  const { data, error } = await context.data.supabase.rpc(
    "list_workspace_writing_activity",
    {
      p_window_seconds: WRITING_ACTIVITY_WINDOW_SECONDS,
      p_workspace_id: parsed.data,
    },
  );
  if (error !== null) {
    return fromDatabaseError(error, "Could not load workspace activity.");
  }
  const rows = data.map((activity) => ({
    avatarSrc: activity.avatar_src,
    documentId: activity.document_id,
    documentSlug: activity.document_slug,
    documentTitle: activity.document_title,
    fullName: activity.full_name,
    lastWrittenAt: activity.last_written_at,
    userId: activity.user_id,
  }));
  return actionSuccess({
    documents: groupWritingActivity(rows, context.data.user.id),
    observedAt: new Date().toISOString(),
  });
};
