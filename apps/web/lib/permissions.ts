import type { WorkspaceRole } from "@/lib/workspace-roles";

export const canEditDocument = (role: WorkspaceRole): boolean =>
  role === "OWNER" || role === "EDITOR";

export const canDeleteDocument = (
  role: WorkspaceRole,
  authorId: string,
  userId: string,
): boolean => role === "OWNER" || (role === "EDITOR" && authorId === userId);

export const canShareDocument = (role: WorkspaceRole): boolean =>
  role === "OWNER";
