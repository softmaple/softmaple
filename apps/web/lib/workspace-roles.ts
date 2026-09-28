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

/** Human-readable role names for badges, menus, and member lists. */
export const WORKSPACE_ROLE_LABEL = {
  [WORKSPACE_ROLE.Editor]: "Editor",
  [WORKSPACE_ROLE.Owner]: "Owner",
  [WORKSPACE_ROLE.Viewer]: "Viewer",
} as const satisfies Readonly<Record<WorkspaceRole, string>>;

export type WorkspaceMemberDirectoryEntry = Omit<
  WorkspaceMemberDirectoryRow,
  "role"
> & { readonly role: WorkspaceRole };
