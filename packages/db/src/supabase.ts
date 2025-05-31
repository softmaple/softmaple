import type {
  User,
  Workspace,
  WorkspaceMember,
  Document,
  DocumentVersion,
  WorkspaceRole,
} from "./index";

export interface Database {
  public: {
    Tables: {
      users: {
        Row: User;
        Insert: Omit<User, "id" | "created_at" | "updated_at"> & {
          id?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Omit<User, "id" | "created_at">> & {
          updated_at?: string;
        };
      };
      workspaces: {
        Row: Workspace;
        Insert: Omit<Workspace, "id" | "created_at" | "updated_at"> & {
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Omit<Workspace, "id" | "created_at">> & {
          updated_at?: string;
        };
      };
      workspace_members: {
        Row: WorkspaceMember;
        Insert: Omit<WorkspaceMember, "id" | "created_at" | "updated_at"> & {
          id?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Omit<WorkspaceMember, "id" | "created_at">> & {
          updated_at?: string;
        };
      };
      documents: {
        Row: Document;
        Insert: Omit<Document, "id" | "created_at" | "updated_at"> & {
          id?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Omit<Document, "id" | "created_at">> & {
          updated_at?: string;
        };
      };
      document_versions: {
        Row: DocumentVersion;
        Insert: Omit<DocumentVersion, "id" | "created_at" | "updated_at"> & {
          id?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Omit<DocumentVersion, "id" | "created_at">> & {
          updated_at?: string;
        };
      };
    };
    Views: {};
    Functions: {};
    Enums: {
      WorkspaceRole: WorkspaceRole;
    };
  };
}
