import { Prisma } from "@softmaple/db";

export const DB_SCHEMA = "public";

export type Database = {
  [DB_SCHEMA]: {
    Tables: {
      users: {
        Row: Prisma.UserGetPayload<{}>;
        Insert: Omit<
          Prisma.UserGetPayload<{}>,
          "id" | "created_at" | "updated_at" | "created_by" | "updated_by"
        >;
        Update: Partial<Prisma.UserGetPayload<{}>>;
      };
      workspaces: {
        Row: Prisma.WorkspaceGetPayload<{}>;
        Insert: Omit<
          Prisma.WorkspaceGetPayload<{}>,
          "id" | "created_at" | "updated_at" | "created_by" | "updated_by"
        >;
        Update: Partial<Prisma.WorkspaceGetPayload<{}>>;
      };
      workspace_members: {
        Row: Prisma.WorkspaceMemberGetPayload<{}>;
        Insert: Omit<
          Prisma.WorkspaceMemberGetPayload<{}>,
          "id" | "created_at" | "updated_at" | "created_by" | "updated_by"
        >;
        Update: Partial<Prisma.WorkspaceMemberGetPayload<{}>>;
      };
      documents: {
        Row: Prisma.DocumentGetPayload<{}>;
        Insert: Omit<
          Prisma.DocumentGetPayload<{}>,
          "id" | "created_at" | "updated_at" | "created_by" | "updated_by"
        >;
        Update: Partial<Prisma.DocumentGetPayload<{}>>;
      };
      document_versions: {
        Row: Prisma.DocumentVersionGetPayload<{}>;
        Insert: Omit<
          Prisma.DocumentVersionGetPayload<{}>,
          "id" | "created_at" | "updated_at" | "created_by" | "updated_by"
        >;
        Update: Partial<Prisma.DocumentVersionGetPayload<{}>>;
      };
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
