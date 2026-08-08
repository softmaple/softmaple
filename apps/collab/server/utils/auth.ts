import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { CollabRole } from "@softmaple/collab-protocol";
import { prisma } from "./prisma";

export interface DocumentAccess {
  readonly documentId: string;
  readonly userId: string;
  readonly role: CollabRole;
  readonly canWrite: boolean;
}

let authClient: SupabaseClient | null = null;

const getAuthClient = (): SupabaseClient => {
  if (authClient !== null) return authClient;

  const url = process.env.SUPABASE_URL;
  const key =
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
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

export const authorizeDocument = async (
  accessToken: string,
  documentId: string,
): Promise<DocumentAccess | null> => {
  const { data, error } = await getAuthClient().auth.getClaims(accessToken);
  const userId = data?.claims.sub;
  if (error || typeof userId !== "string" || userId.length === 0) {
    return null;
  }

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
    documentId: document.id,
    userId,
    role: member.role,
    canWrite: member.role === "OWNER" || member.role === "EDITOR",
  };
};
