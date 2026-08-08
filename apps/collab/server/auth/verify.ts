import { createClient } from "@supabase/supabase-js";
import {
  CollabErrorCode,
  CollabProtocolError,
  WorkspaceRole,
  canWriteRole,
  type WorkspaceRole as WorkspaceRoleValue,
} from "@softmaple/collab-protocol";
import type { PrismaClient } from "@softmaple/db";

export interface AuthContext {
  readonly userId: string;
  readonly documentId: string;
  readonly workspaceId: number;
  readonly role: WorkspaceRoleValue;
  readonly canWrite: boolean;
}

const parseDevToken = (
  accessToken: string,
): { userId: string; role: WorkspaceRoleValue } | null => {
  if (process.env.COLLAB_DEV_AUTH_BYPASS !== "true") return null;
  if (!accessToken.startsWith("dev:")) return null;
  const parts = accessToken.split(":");
  if (parts.length !== 3) return null;
  const userId = parts[1];
  const role = parts[2];
  if (!userId || userId.length === 0) return null;
  if (
    role !== WorkspaceRole.Owner &&
    role !== WorkspaceRole.Editor &&
    role !== WorkspaceRole.Viewer
  ) {
    return null;
  }
  return { userId, role };
};

const resolveSupabaseUserId = async (accessToken: string): Promise<string> => {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new CollabProtocolError(
      CollabErrorCode.Internal,
      "SUPABASE_URL / SUPABASE_ANON_KEY are not configured",
    );
  }
  const supabase = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.auth.getUser(accessToken);
  if (error || !data.user) {
    throw new CollabProtocolError(
      CollabErrorCode.Unauthorized,
      "Invalid or expired access token",
    );
  }
  return data.user.id;
};

export const authenticateDocumentAccess = async (
  prisma: PrismaClient,
  accessToken: string,
  documentId: string,
): Promise<AuthContext> => {
  const dev = parseDevToken(accessToken);
  const userId = dev ? dev.userId : await resolveSupabaseUserId(accessToken);

  const document = await prisma.document.findUnique({
    where: { id: documentId },
    select: { id: true, workspace_id: true },
  });
  if (!document) {
    throw new CollabProtocolError(
      CollabErrorCode.Forbidden,
      "Document not found",
      { documentId },
    );
  }

  if (dev) {
    return {
      userId,
      documentId,
      workspaceId: document.workspace_id,
      role: dev.role,
      canWrite: canWriteRole(dev.role),
    };
  }

  const membership = await prisma.workspaceMember.findUnique({
    where: {
      user_id_workspace_id: {
        user_id: userId,
        workspace_id: document.workspace_id,
      },
    },
    select: { role: true },
  });

  if (!membership) {
    throw new CollabProtocolError(
      CollabErrorCode.Forbidden,
      "Not a workspace member",
      { documentId, userId },
    );
  }

  const role = membership.role as WorkspaceRoleValue;
  return {
    userId,
    documentId,
    workspaceId: document.workspace_id,
    role,
    canWrite: canWriteRole(role),
  };
};
