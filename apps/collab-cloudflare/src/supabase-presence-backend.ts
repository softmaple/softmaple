import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type {
  PresenceIdentity,
  PresenceSessionHooks,
} from "@softmaple/collab-runtime";
import type { CollabDatabase } from "./supabaseTypes";

/**
 * DO-local Supabase presence backend. Deliberately independent from
 * `supabase-backend.ts`: `PresenceRoomDO` must share no capability instance
 * with `DocumentRoomDO` (see docs/design/collaboration-runtime.md), so the
 * clients and queries here are not imported from — or shared with — the
 * document object, even though the underlying membership check is similar.
 */
interface SupabasePresenceBackendEnv {
  readonly SUPABASE_PUBLISHABLE_KEY: string;
  readonly SUPABASE_SERVICE_ROLE_KEY: string;
  readonly SUPABASE_URL: string;
}

interface DocumentRow {
  readonly id: string;
  readonly workspace_id: number;
}

interface MemberRow {
  readonly user_id: string;
}

interface UserRow {
  readonly avatar_src: string | null;
  readonly full_name: string | null;
}

type PresenceSupabaseClient = SupabaseClient<CollabDatabase>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const documentRow = (value: unknown): DocumentRow | null => {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.workspace_id !== "number"
  ) {
    return null;
  }
  return { id: value.id, workspace_id: value.workspace_id };
};

const memberRow = (value: unknown): MemberRow | null => {
  if (!isRecord(value) || typeof value.user_id !== "string") return null;
  return { user_id: value.user_id };
};

const userRow = (value: unknown): UserRow | null => {
  if (
    !isRecord(value) ||
    (value.avatar_src !== null && typeof value.avatar_src !== "string") ||
    (value.full_name !== null && typeof value.full_name !== "string")
  ) {
    return null;
  }
  return {
    avatar_src: value.avatar_src as string | null,
    full_name: value.full_name as string | null,
  };
};

const identityFromUserRow = (
  userId: string,
  row: UserRow,
): PresenceIdentity => ({
  name: row.full_name?.trim() || "Workspace member",
  userId,
  ...(row.avatar_src === null ? {} : { avatarUrl: row.avatar_src }),
});

const clientOptions = {
  auth: {
    autoRefreshToken: false,
    detectSessionInUrl: false,
    persistSession: false,
  },
} as const;

const createClients = (env: SupabasePresenceBackendEnv) => ({
  admin: createClient<CollabDatabase>(
    env.SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    clientOptions,
  ),
  auth: createClient<CollabDatabase>(
    env.SUPABASE_URL,
    env.SUPABASE_PUBLISHABLE_KEY,
    clientOptions,
  ),
});

/**
 * Resolves a presence identity for `roomId` (a document id). Presence is
 * authenticated-only: a public credential, a revoked token, or a user with
 * no workspace membership on the document all deny access, regardless of
 * whether the document itself is publicly readable.
 */
const resolveIdentity = async (
  auth: PresenceSupabaseClient,
  admin: PresenceSupabaseClient,
  token: string,
  roomId: string,
  claimedUserId: string,
): Promise<PresenceIdentity | null> => {
  const { data: claimsData, error: claimsError } =
    await auth.auth.getClaims(token);
  const userId = claimsData?.claims.sub;
  if (
    claimsError !== null ||
    typeof userId !== "string" ||
    userId.length === 0 ||
    userId !== claimedUserId
  ) {
    return null;
  }

  const { data: rawDocument, error: documentError } = await admin
    .from("documents")
    .select("id,workspace_id")
    .eq("id", roomId)
    .maybeSingle();
  if (documentError !== null) throw documentError;
  const document = documentRow(rawDocument as unknown);
  if (document === null) return null;

  const { data: rawMember, error: memberError } = await admin
    .from("workspace_members")
    .select("user_id")
    .eq("user_id", userId)
    .eq("workspace_id", document.workspace_id)
    .maybeSingle();
  if (memberError !== null) throw memberError;
  if (memberRow(rawMember as unknown) === null) return null;

  const { data: rawUser, error: userError } = await admin
    .from("users")
    .select("full_name,avatar_src")
    .eq("id", userId)
    .maybeSingle();
  if (userError !== null) throw userError;
  const user = userRow(rawUser as unknown);
  if (user === null) return null;

  return identityFromUserRow(userId, user);
};

export interface PresenceBackend {
  readonly sessions: PresenceSessionHooks;
}

export type SupabasePresenceBackend = PresenceBackend;

export const createSupabasePresenceBackend = (
  env: SupabasePresenceBackendEnv,
): SupabasePresenceBackend => {
  const { admin, auth } = createClients(env);

  const sessions: PresenceSessionHooks = {
    async authorize(request) {
      if (request.credential.kind !== "access-token") return null;
      return resolveIdentity(
        auth,
        admin,
        request.credential.token,
        request.roomId,
        request.userId,
      );
    },
    async refresh(request) {
      if (request.credential.kind !== "access-token") return null;
      return resolveIdentity(
        auth,
        admin,
        request.credential.token,
        request.session.roomId,
        request.session.identity.userId,
      );
    },
  };

  return { sessions };
};
