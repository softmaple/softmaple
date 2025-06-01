import { Prisma } from "@softmaple/db";

export const DB_SCHEMA = "public";

type BaseFields =
  | "id"
  | "created_at"
  | "updated_at"
  | "created_by"
  | "updated_by";

type CreateTableType<T> = {
  Row: T;
  Insert: Partial<Omit<T, BaseFields>>;
  Update: Partial<T>;
};

export type Database = {
  [DB_SCHEMA]: {
    Tables: {
      users: CreateTableType<Prisma.UserGetPayload<{}>>;
      workspaces: CreateTableType<Prisma.WorkspaceGetPayload<{}>>;
      workspace_members: CreateTableType<Prisma.WorkspaceMemberGetPayload<{}>>;
      documents: CreateTableType<Prisma.DocumentGetPayload<{}>>;
      document_versions: CreateTableType<Prisma.DocumentVersionGetPayload<{}>>;
    };
  };
};

/**
 * type X = Table<"users">
 *
 * @example
 * const x: X["Row"]
 */
export type Table<T extends keyof Database[typeof DB_SCHEMA]["Tables"]> =
  Database[typeof DB_SCHEMA]["Tables"][T];
