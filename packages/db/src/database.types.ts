// Generated shape for the public Supabase schema after the core v1 migration.
// Regenerate with `pnpm --filter @softmaple/db db:types` after schema changes.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      document_event_batches: {
        Row: {
          actor_id: string;
          batch_id: string;
          created_at: string;
          document_id: string;
          id: number;
          parent_version: string[];
          payload: Json;
          payload_hash: string;
          schema_version: number;
        };
        Insert: {
          actor_id: string;
          batch_id: string;
          created_at?: string;
          document_id: string;
          id?: number;
          parent_version: string[];
          payload: Json;
          payload_hash: string;
          schema_version: number;
        };
        Update: {
          actor_id?: string;
          batch_id?: string;
          created_at?: string;
          document_id?: string;
          id?: number;
          parent_version?: string[];
          payload?: Json;
          payload_hash?: string;
          schema_version?: number;
        };
        Relationships: [
          {
            foreignKeyName: "document_event_batches_document_id_fkey";
            columns: ["document_id"];
            isOneToOne: false;
            referencedRelation: "documents";
            referencedColumns: ["id"];
          },
        ];
      };
      document_event_ids: {
        Row: {
          batch_row_id: number;
          document_id: string;
          event_id: string;
        };
        Insert: {
          batch_row_id: number;
          document_id: string;
          event_id: string;
        };
        Update: {
          batch_row_id?: number;
          document_id?: string;
          event_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "document_event_ids_batch_row_id_document_id_fkey";
            columns: ["batch_row_id", "document_id"];
            isOneToOne: false;
            referencedRelation: "document_event_batches";
            referencedColumns: ["id", "document_id"];
          },
        ];
      };
      documents: {
        Row: {
          author_id: string;
          created_at: string;
          created_by: string | null;
          id: string;
          is_public: boolean;
          slug: string;
          title: string;
          updated_at: string | null;
          updated_by: string | null;
          workspace_id: number;
        };
        Insert: {
          author_id: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          is_public?: boolean;
          slug: string;
          title: string;
          updated_at?: string | null;
          updated_by?: string | null;
          workspace_id: number;
        };
        Update: {
          author_id?: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          is_public?: boolean;
          slug?: string;
          title?: string;
          updated_at?: string | null;
          updated_by?: string | null;
          workspace_id?: number;
        };
        Relationships: [
          {
            foreignKeyName: "documents_author_id_fkey";
            columns: ["author_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "documents_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      users: {
        Row: {
          avatar_alt: string | null;
          avatar_src: string | null;
          created_at: string;
          created_by: string | null;
          email: string;
          first_name: string | null;
          full_name: string | null;
          id: string;
          last_name: string | null;
          updated_at: string | null;
          updated_by: string | null;
        };
        Insert: {
          avatar_alt?: string | null;
          avatar_src?: string | null;
          created_at?: string;
          created_by?: string | null;
          email: string;
          first_name?: string | null;
          full_name?: string | null;
          id?: string;
          last_name?: string | null;
          updated_at?: string | null;
          updated_by?: string | null;
        };
        Update: {
          avatar_alt?: string | null;
          avatar_src?: string | null;
          created_at?: string;
          created_by?: string | null;
          email?: string;
          first_name?: string | null;
          full_name?: string | null;
          id?: string;
          last_name?: string | null;
          updated_at?: string | null;
          updated_by?: string | null;
        };
        Relationships: [];
      };
      workspace_members: {
        Row: {
          created_at: string;
          created_by: string | null;
          id: string;
          invited_by: string | null;
          role: Database["public"]["Enums"]["WorkspaceMemberRole"];
          updated_at: string | null;
          updated_by: string | null;
          user_id: string;
          workspace_id: number;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          id?: string;
          invited_by?: string | null;
          role?: Database["public"]["Enums"]["WorkspaceMemberRole"];
          updated_at?: string | null;
          updated_by?: string | null;
          user_id: string;
          workspace_id: number;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          id?: string;
          invited_by?: string | null;
          role?: Database["public"]["Enums"]["WorkspaceMemberRole"];
          updated_at?: string | null;
          updated_by?: string | null;
          user_id?: string;
          workspace_id?: number;
        };
        Relationships: [
          {
            foreignKeyName: "workspace_members_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "workspace_members_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      workspaces: {
        Row: {
          avatar_alt: string | null;
          avatar_src: string | null;
          created_at: string;
          created_by: string | null;
          description: string | null;
          id: number;
          owner_id: string;
          slug: string;
          title: string;
          updated_at: string | null;
          updated_by: string | null;
        };
        Insert: {
          avatar_alt?: string | null;
          avatar_src?: string | null;
          created_at?: string;
          created_by?: string | null;
          description?: string | null;
          id?: number;
          owner_id: string;
          slug: string;
          title: string;
          updated_at?: string | null;
          updated_by?: string | null;
        };
        Update: {
          avatar_alt?: string | null;
          avatar_src?: string | null;
          created_at?: string;
          created_by?: string | null;
          description?: string | null;
          id?: number;
          owner_id?: string;
          slug?: string;
          title?: string;
          updated_at?: string | null;
          updated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "workspaces_owner_id_fkey";
            columns: ["owner_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: { [_ in never]: never };
    Functions: {
      add_workspace_member_by_email: {
        Args: { p_email: string; p_role: string; p_workspace_id: number };
        Returns: string;
      };
      get_public_document_by_slug: {
        Args: { p_slug: string };
        Returns: {
          id: string;
          slug: string;
          title: string;
          updated_at: string | null;
        }[];
      };
      list_workspace_members: {
        Args: { p_workspace_id: number };
        Returns: {
          avatar_src: string | null;
          email: string | null;
          full_name: string;
          joined_at: string;
          member_id: string;
          role: string;
          user_id: string;
        }[];
      };
      remove_workspace_member: {
        Args: { p_member_id: string; p_workspace_id: number };
        Returns: undefined;
      };
      set_document_public: {
        Args: { p_document_id: string; p_enabled: boolean };
        Returns: undefined;
      };
      set_workspace_member_role: {
        Args: {
          p_member_id: string;
          p_role: string;
          p_workspace_id: number;
        };
        Returns: undefined;
      };
    };
    Enums: {
      WorkspaceMemberRole: "OWNER" | "EDITOR" | "VIEWER";
      WorkspaceRole: "OWNER" | "EDITOR" | "VIEWER";
    };
    CompositeTypes: { [_ in never]: never };
  };
};
