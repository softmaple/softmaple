import { parseRichTextEventBatch } from "@softmaple/block-model";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  COLLAB_ACCESS_MODE,
  type CollabCredential,
  type CollabRole,
} from "@softmaple/collab-protocol";
import {
  DOCUMENT_EVENT_CONFLICT_TYPE,
  DocumentEventAuthorizationError,
  DocumentEventConflictError,
  type DocumentEventConflictType,
  DocumentEventStoreUnavailableError,
  type DocumentAccess,
} from "@softmaple/collab-runtime";
import type { DocumentBackend } from "./room-services";
import type { CollabDatabase } from "./supabaseTypes";

interface SupabaseBackendEnv {
  readonly SUPABASE_PUBLISHABLE_KEY: string;
  readonly SUPABASE_SERVICE_ROLE_KEY: string;
  readonly SUPABASE_URL: string;
}

interface DocumentRow {
  readonly id: string;
  readonly is_public: boolean;
  readonly workspace_id: number;
}

interface MemberRow {
  readonly role: CollabRole;
}

interface RpcErrorShape {
  readonly batchIds?: ReadonlyArray<string>;
  readonly conflictType?: string;
  readonly documentId?: string;
  readonly eventIds?: ReadonlyArray<string>;
  readonly kind?: string;
  readonly message?: string;
  readonly missingParentIds?: ReadonlyArray<string>;
}

type CollabSupabaseClient = SupabaseClient<CollabDatabase>;
type AppendRpcBatches =
  CollabDatabase["public"]["Functions"]["append_document_event_batches"]["Args"]["p_batches"];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isStringArray = (value: unknown): value is ReadonlyArray<string> =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

const isCollabRole = (value: unknown): value is CollabRole =>
  value === "OWNER" || value === "EDITOR" || value === "VIEWER";

const documentRow = (value: unknown): DocumentRow | null => {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.is_public !== "boolean" ||
    typeof value.workspace_id !== "number"
  ) {
    return null;
  }
  return {
    id: value.id,
    is_public: value.is_public,
    workspace_id: value.workspace_id,
  };
};

const memberRow = (value: unknown): MemberRow | null => {
  if (!isRecord(value) || !isCollabRole(value.role)) return null;
  return { role: value.role };
};

const canonicalJson = (value: unknown): string => {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  ) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  throw new Error("event batch contains a non-JSON value");
};

const sha256 = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

const isConflictType = (value: unknown): value is DocumentEventConflictType =>
  Object.values(DOCUMENT_EVENT_CONFLICT_TYPE).some(
    (conflictType) => conflictType === value,
  );

const rpcErrorShape = (message: string): RpcErrorShape | null => {
  try {
    const value: unknown = JSON.parse(message);
    if (!isRecord(value)) return null;
    return {
      ...(isStringArray(value.batchIds) ? { batchIds: value.batchIds } : {}),
      ...(typeof value.conflictType === "string"
        ? { conflictType: value.conflictType }
        : {}),
      ...(typeof value.documentId === "string"
        ? { documentId: value.documentId }
        : {}),
      ...(isStringArray(value.eventIds) ? { eventIds: value.eventIds } : {}),
      ...(typeof value.kind === "string" ? { kind: value.kind } : {}),
      ...(typeof value.message === "string" ? { message: value.message } : {}),
      ...(isStringArray(value.missingParentIds)
        ? { missingParentIds: value.missingParentIds }
        : {}),
    };
  } catch {
    return null;
  }
};

const appendError = (
  documentId: string,
  error: Readonly<{ message: string }>,
):
  | DocumentEventAuthorizationError
  | DocumentEventConflictError
  | DocumentEventStoreUnavailableError => {
  const shape = rpcErrorShape(error.message);
  if (shape?.kind === "authorization") {
    return new DocumentEventAuthorizationError(
      shape.message ?? "actor no longer has document write access",
    );
  }
  if (shape?.kind === "conflict" && isConflictType(shape.conflictType)) {
    return new DocumentEventConflictError("document event conflict", {
      conflictType: shape.conflictType,
      documentId: shape.documentId ?? documentId,
      ...(shape.batchIds === undefined ? {} : { batchIds: shape.batchIds }),
      ...(shape.eventIds === undefined ? {} : { eventIds: shape.eventIds }),
      ...(shape.missingParentIds === undefined
        ? {}
        : { missingParentIds: shape.missingParentIds }),
    });
  }
  return new DocumentEventStoreUnavailableError(
    "Document event append is unavailable",
    { cause: error },
  );
};

const clientOptions = {
  auth: {
    autoRefreshToken: false,
    detectSessionInUrl: false,
    persistSession: false,
  },
} as const;

const createClients = (env: SupabaseBackendEnv) => ({
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

const publicDocumentAccess = (): DocumentAccess => ({
  accessMode: COLLAB_ACCESS_MODE.Public,
  actorId: null,
  canWrite: false,
  role: null,
});

const authorizePublic = async (
  admin: CollabSupabaseClient,
  documentId: string,
): Promise<DocumentAccess | null> => {
  const { data, error } = await admin
    .from("documents")
    .select("id,is_public,workspace_id")
    .eq("id", documentId)
    .eq("is_public", true)
    .maybeSingle();
  if (error !== null) throw error;
  const document = documentRow(data as unknown);
  if (document === null || !document.is_public) return null;
  return publicDocumentAccess();
};

const authorizeAuthenticated = async (
  auth: CollabSupabaseClient,
  admin: CollabSupabaseClient,
  token: string,
  documentId: string,
): Promise<DocumentAccess | null> => {
  const { data: claimsData, error: claimsError } =
    await auth.auth.getClaims(token);
  const userId = claimsData?.claims.sub;
  if (
    claimsError !== null ||
    typeof userId !== "string" ||
    userId.length === 0
  ) {
    return null;
  }

  const { data: rawDocument, error: documentError } = await admin
    .from("documents")
    .select("id,is_public,workspace_id")
    .eq("id", documentId)
    .maybeSingle();
  if (documentError !== null) throw documentError;
  const document = documentRow(rawDocument as unknown);
  if (document === null) return null;

  const { data: rawMember, error: memberError } = await admin
    .from("workspace_members")
    .select("role")
    .eq("user_id", userId)
    .eq("workspace_id", document.workspace_id)
    .maybeSingle();
  if (memberError !== null) throw memberError;
  const member = memberRow(rawMember as unknown);
  if (member === null) return null;

  return {
    accessMode: COLLAB_ACCESS_MODE.Authenticated,
    actorId: userId,
    canWrite: member.role === "OWNER" || member.role === "EDITOR",
    role: member.role,
  };
};

const authorize = async (
  auth: CollabSupabaseClient,
  admin: CollabSupabaseClient,
  credential: CollabCredential,
  documentId: string,
): Promise<DocumentAccess | null> =>
  credential.kind === "public"
    ? authorizePublic(admin, documentId)
    : authorizeAuthenticated(auth, admin, credential.token, documentId);

export type SupabaseDocumentBackend = DocumentBackend;

export const createSupabaseDocumentBackend = (
  env: SupabaseBackendEnv,
): SupabaseDocumentBackend => {
  const { admin, auth } = createClients(env);

  const events: DocumentBackend["events"] = {
    async append(documentId, actorId, batches) {
      const rpcBatches = await Promise.all(
        batches.map(async (batch) => ({
          payload: batch,
          payloadHash: await sha256(canonicalJson(batch)),
        })),
      );
      const { data, error } = await admin.rpc("append_document_event_batches", {
        p_actor_id: actorId,
        // RichTextEventBatch is protocol-validated JSON, but its named
        // interface intentionally lacks Json's open index signature.
        p_batches: rpcBatches as unknown as AppendRpcBatches,
        p_document_id: documentId,
      });
      if (error !== null) throw appendError(documentId, error);
      const result: unknown = data;
      if (!isStringArray(result) || result.length !== batches.length) {
        throw new DocumentEventStoreUnavailableError(
          "Document event append returned an invalid acknowledgement",
        );
      }
      return result;
    },

    async read(documentId, afterCursor) {
      const { data, error } = await admin.rpc("read_document_event_page", {
        p_after_cursor: afterCursor,
        p_document_id: documentId,
        p_limit: 100,
      });
      if (error !== null) {
        throw new DocumentEventStoreUnavailableError(
          "Document event read is unavailable",
          { cause: error },
        );
      }
      const result: unknown = data;
      if (
        !isRecord(result) ||
        !Array.isArray(result.batches) ||
        typeof result.complete !== "boolean" ||
        typeof result.nextCursor !== "string" ||
        !/^\d+$/.test(result.nextCursor)
      ) {
        throw new DocumentEventStoreUnavailableError(
          "Document event read returned an invalid page",
        );
      }
      try {
        return {
          batches: result.batches.map(parseRichTextEventBatch),
          complete: result.complete,
          nextCursor: result.nextCursor,
        };
      } catch (error) {
        throw new DocumentEventStoreUnavailableError(
          "Document event read returned invalid history",
          { cause: error },
        );
      }
    },
  };

  const sessions: DocumentBackend["sessions"] = {
    async authorize(request) {
      return authorize(auth, admin, request.credential, request.documentId);
    },
    async refresh(request) {
      return authorize(
        auth,
        admin,
        request.credential,
        request.session.documentId,
      );
    },
  };

  return { events, sessions };
};
