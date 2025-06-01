import { Prisma } from "@softmaple/db";

export const DB_SCHEMA = "public";

type BaseFields =
  | "id"
  | "created_at"
  | "updated_at"
  | "created_by"
  | "updated_by";

type NullableFields<T> = {
  [K in keyof T]: null extends T[K] ? K : never;
}[keyof T];

type RequiredFields<T> = {
  [K in keyof T]: null extends T[K] ? never : K;
}[keyof T];

type CreateTableType<T> = {
  Row: T;
  Insert: {
    [K in RequiredFields<Omit<T, BaseFields>>]: Omit<T, BaseFields>[K];
  } & {
    [K in NullableFields<Omit<T, BaseFields>>]?: Omit<T, BaseFields>[K];
  };
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
