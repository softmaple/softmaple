import type { WorkspaceMemberDirectoryRow } from "@/types/model";

export const WORKSPACE_ROLE = {
  Editor: "EDITOR",
  Owner: "OWNER",
  Viewer: "VIEWER",
} as const;

export type WorkspaceRole =
  (typeof WORKSPACE_ROLE)[keyof typeof WORKSPACE_ROLE];

export type ManageableWorkspaceRole = Exclude<
  WorkspaceRole,
  typeof WORKSPACE_ROLE.Owner
>;

export type WorkspaceMemberDirectoryEntry = Omit<
  WorkspaceMemberDirectoryRow,
  "role"
> & { readonly role: WorkspaceRole };
