import { ServerCrud } from "./server";
import { ClientCrud } from "./client";
import { TABLES } from "@/utils/constants/tables";
import type { TableName } from "@/types/crud";

export const createServerCrud = <T extends TableName>(tableName: T) =>
  new ServerCrud(tableName);

export const createClientCrud = <T extends TableName>(tableName: T) =>
  new ClientCrud(tableName);

export const serverCrud = {
  users: () => createServerCrud(TABLES.USERS.name),
  workspaces: () => createServerCrud(TABLES.WORKSPACES.name),
  workspaceMembers: () => createServerCrud(TABLES.WORKSPACE_MEMBERS.name),
  documents: () => createServerCrud(TABLES.DOCUMENTS.name),
  documentVersions: () => createServerCrud(TABLES.DOCUMENT_VERSIONS.name),
};

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
} from "@/types/crud";

export { TABLES } from "@/utils/constants/tables";

export { DOCUMENTS_TABLE } from "@/utils/constants/tables";
