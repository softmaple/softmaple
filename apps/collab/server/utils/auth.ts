import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  COLLAB_ACCESS_MODE,
  type CollabCredential,
  type CollabRole,
} from "@softmaple/collab-protocol";
import { prisma } from "./prisma";

export type AuthenticatedDocumentAccess = {
  readonly accessMode: typeof COLLAB_ACCESS_MODE.Authenticated;
  readonly documentId: string;
  readonly userId: string;
  readonly role: CollabRole;
  readonly canWrite: boolean;
};

export type PublicDocumentAccess = {
  readonly accessMode: typeof COLLAB_ACCESS_MODE.Public;
  readonly documentId: string;
  readonly userId: null;
  readonly role: null;
  readonly canWrite: false;
};

export type DocumentAccess = AuthenticatedDocumentAccess | PublicDocumentAccess;

let authClient: SupabaseClient | null = null;

const getAuthClient = (): SupabaseClient => {
  if (authClient !== null) return authClient;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    throw new Error(
      "SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY are required by collab",
    );
  }
  authClient = createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
  return authClient;
};

const authorizePublicDocument = async (
  documentId: string,
): Promise<PublicDocumentAccess | null> => {
  const document = await prisma.document.findFirst({
    where: { id: documentId, is_public: true },
    select: { id: true },
  });
  if (document === null) return null;
  return {
    accessMode: COLLAB_ACCESS_MODE.Public,
    documentId: document.id,
    userId: null,
    role: null,
    canWrite: false,
  };
};

const authorizeAuthenticatedDocument = async (
  token: string,
  documentId: string,
): Promise<AuthenticatedDocumentAccess | null> => {
  const { data, error } = await getAuthClient().auth.getClaims(token);
  const userId = data?.claims.sub;
  if (error || typeof userId !== "string" || userId.length === 0) return null;

  const document = await prisma.document.findUnique({
    where: { id: documentId },
    select: { id: true, workspace_id: true },
  });
  if (document === null) return null;
  const member = await prisma.workspaceMember.findUnique({
    where: {
      user_id_workspace_id: {
        user_id: userId,
        workspace_id: document.workspace_id,
      },
    },
    select: { role: true },
  });
  if (member === null) return null;
  return {
    accessMode: COLLAB_ACCESS_MODE.Authenticated,
    documentId: document.id,
    userId,
    role: member.role,
    canWrite: member.role === "OWNER" || member.role === "EDITOR",
  };
};

export const authorizeDocument = async (
  credential: CollabCredential,
  documentId: string,
): Promise<DocumentAccess | null> =>
  credential.kind === "public"
    ? authorizePublicDocument(documentId)
    : authorizeAuthenticatedDocument(credential.token, documentId);
