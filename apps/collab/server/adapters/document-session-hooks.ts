import type {
  DocumentAccess as RuntimeDocumentAccess,
  DocumentSessionHooks,
} from "@softmaple/collab-runtime";
import { authorizeDocument, type DocumentAccess } from "../utils/auth";
import { logDocumentRoomError } from "./document-room-logging";

const toRuntimeAccess = (
  access: DocumentAccess,
): RuntimeDocumentAccess | null => {
  if (access.accessMode === "public") {
    return {
      accessMode: access.accessMode,
      actorId: null,
      canWrite: false,
      role: null,
    };
  }
  return {
    accessMode: access.accessMode,
    actorId: access.userId,
    canWrite: access.canWrite,
    role: access.role,
  };
};

const resolveAccess = async (
  credential: Parameters<typeof authorizeDocument>[0],
  documentId: string,
  operation: string,
): Promise<RuntimeDocumentAccess | null> => {
  try {
    const access = await authorizeDocument(credential, documentId);
    if (access === null || access.documentId !== documentId) return null;
    return toRuntimeAccess(access);
  } catch (error) {
    logDocumentRoomError(error, documentId, operation);
    throw error;
  }
};

export const documentSessionHooks: DocumentSessionHooks = {
  authorize: ({ credential, documentId }) =>
    resolveAccess(credential, documentId, "auth"),
  refresh: ({ credential, session }) =>
    resolveAccess(credential, session.documentId, "authorization-recheck"),
};
