import type {
  User,
  Workspace,
  WorkspaceMember,
  Document,
  DocumentVersion,
  Prisma,
  $Enums,
} from "../generated/prisma";

export interface Database {
  public: {
    Tables: {
      users: {
        Row: User;
        Insert: Prisma.UserUncheckedCreateInput;
        Update: Prisma.UserUncheckedUpdateInput;
      };
      workspaces: {
        Row: Workspace;
        Insert: Prisma.WorkspaceUncheckedCreateInput;
        Update: Prisma.WorkspaceUncheckedUpdateInput;
      };
      workspace_members: {
        Row: WorkspaceMember;
        Insert: Prisma.WorkspaceMemberUncheckedCreateInput;
        Update: Prisma.WorkspaceMemberUncheckedUpdateInput;
      };
      documents: {
        Row: Document;
        Insert: Prisma.DocumentUncheckedCreateInput;
        Update: Prisma.DocumentUncheckedUpdateInput;
      };
      document_versions: {
        Row: DocumentVersion;
        Insert: Prisma.DocumentVersionUncheckedCreateInput;
        Update: Prisma.DocumentVersionUncheckedUpdateInput;
      };
    };
    Views: {};
    Functions: {};
    Enums: {
      WorkspaceRole: $Enums.WorkspaceRole;
    };
  };
}
