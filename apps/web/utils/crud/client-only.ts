import { createClientCrud } from "./client";
import { TABLES } from "../constants/tables";

export const clientCrud = {
  users: () => createClientCrud(TABLES.USERS.name),
  workspaces: () => createClientCrud(TABLES.WORKSPACES.name),
  workspaceMembers: () => createClientCrud(TABLES.WORKSPACE_MEMBERS.name),
  documents: () => createClientCrud(TABLES.DOCUMENTS.name),
  documentVersions: () => createClientCrud(TABLES.DOCUMENT_VERSIONS.name),
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
} from "../../types/crud";

export { TABLES } from "../constants/tables";

export { DOCUMENTS_TABLE } from "../constants/tables";
