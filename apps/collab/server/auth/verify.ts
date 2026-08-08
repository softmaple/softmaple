import { createClient } from "@supabase/supabase-js";
import {
  CollabErrorCode,
  CollabProtocolError,
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

const isIsolatedDevBypassEnabled = (): boolean =>
  process.env.COLLAB_DEV_AUTH_BYPASS === "true" &&
  process.env.NODE_ENV === "development";

/** Dev tokens only supply userId (`dev:<userId>` or legacy `dev:<userId>:<ROLE>`). */
const parseDevUserId = (accessToken: string): string | null => {
  if (!isIsolatedDevBypassEnabled()) return null;
  if (!accessToken.startsWith("dev:")) return null;
  const parts = accessToken.split(":");
  if (parts.length < 2 || parts.length > 3) return null;
  const userId = parts[1];
  if (!userId || userId.length === 0) return null;
  return userId;
};

export const resolveAccessTokenUserId = async (
  accessToken: string,
): Promise<string> => {
  const devUserId = parseDevUserId(accessToken);
  if (devUserId) return devUserId;

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
  const userId = await resolveAccessTokenUserId(accessToken);

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
