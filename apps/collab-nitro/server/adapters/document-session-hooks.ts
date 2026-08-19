import {
  type DocumentAccess as RuntimeDocumentAccess,
  type DocumentSessionHooks,
} from "@softmaple/collab-runtime";
import { COLLAB_ACCESS_MODE } from "@softmaple/collab-protocol";
import {
  authorizeDocument,
  type DocumentAccess as HostedDocumentAccess,
} from "../utils/auth";

const toRuntimeAccess = (
  access: HostedDocumentAccess | null,
  expectedDocumentId: string,
): RuntimeDocumentAccess | null => {
  if (access === null || access.documentId !== expectedDocumentId) return null;
  if (access.accessMode === COLLAB_ACCESS_MODE.Public) {
    return {
      accessMode: COLLAB_ACCESS_MODE.Public,
      actorId: null,
      canWrite: false,
      role: null,
    };
  }
  return {
    accessMode: COLLAB_ACCESS_MODE.Authenticated,
    actorId: access.userId,
    canWrite: access.canWrite,
    role: access.role,
  };
};

/** Supabase + Prisma authorization presented as runtime-neutral session hooks. */
export const documentSessionHooks: DocumentSessionHooks = {
  async authorize(request) {
    const access = await authorizeDocument(
      request.credential,
      request.documentId,
    );
    return toRuntimeAccess(access, request.documentId);
  },

  async refresh(request) {
    const access = await authorizeDocument(
      request.credential,
      request.session.documentId,
    );
    return toRuntimeAccess(access, request.session.documentId);
  },
};
