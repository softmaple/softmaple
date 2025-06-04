export const TABLES = {
  USERS: {
    name: "users" as const,
  },
  WORKSPACES: {
    name: "workspaces" as const,
  },
  WORKSPACE_MEMBERS: {
    name: "workspace_members" as const,
  },
  DOCUMENTS: {
    name: "documents" as const,
  },
  DOCUMENT_VERSIONS: {
    name: "document_versions" as const,
  },
} as const;

export const DOCUMENTS_TABLE = TABLES.DOCUMENTS;
export const USERS_TABLE = TABLES.USERS;
export const WORKSPACES_TABLE = TABLES.WORKSPACES;
export const WORKSPACE_MEMBERS_TABLE = TABLES.WORKSPACE_MEMBERS;
export const DOCUMENT_VERSIONS_TABLE = TABLES.DOCUMENT_VERSIONS;
