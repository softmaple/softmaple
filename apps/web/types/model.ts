import type { Database } from "@softmaple/db";

export type { Database } from "@softmaple/db";

export const DB_SCHEMA = "public" as const;

export type Table<TName extends keyof Database[typeof DB_SCHEMA]["Tables"]> =
  Database[typeof DB_SCHEMA]["Tables"][TName];

export type DocsType = Table<"documents">;
export type WorkspacesType = Table<"workspaces">;
export type UsersType = Table<"users">;
export type WorkspaceMembersType = Table<"workspace_members">;

export type WorkspaceMemberDirectoryRow =
  Database["public"]["Functions"]["list_workspace_members"]["Returns"][number];
export type PublicDocumentRow =
  Database["public"]["Functions"]["get_public_document_by_slug"]["Returns"][number];
