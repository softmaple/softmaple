import { createServerCrud } from "./server";
import { TABLES } from "@/utils/constants/tables";

export { createServerCrud } from "./server";

export const serverCrud = {
  users: () => createServerCrud(TABLES.USERS.name),
  workspaces: () => createServerCrud(TABLES.WORKSPACES.name),
  workspaceMembers: () => createServerCrud(TABLES.WORKSPACE_MEMBERS.name),
  documents: () => createServerCrud(TABLES.DOCUMENTS.name),
  documentVersions: () => createServerCrud(TABLES.DOCUMENT_VERSIONS.name),
};

export type {
  TableName,
  BaseCrudOperations,
  CrudFilter,
  CrudOptions,
  CreateOptions,
  UpdateOptions,
  DeleteOptions,
  CrudResult,
  CrudListResult,
} from "@/types/crud";

export { TABLES } from "@/utils/constants/tables";

export { DOCUMENTS_TABLE } from "@/utils/constants/tables";
