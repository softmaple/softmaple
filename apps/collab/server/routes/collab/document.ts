import {
  COLLAB_ACCESS_MODE,
  COLLAB_ERROR_CODE,
  COLLAB_MESSAGE_TYPE,
  COLLAB_PROTOCOL_VERSION,
  LEGACY_COLLAB_PROTOCOL_VERSION,
  parseClientCollabMessage,
  type CollabCredential,
  type CollabErrorCode,
  type SupportedCollabProtocolVersion,
} from "@softmaple/collab-protocol";
import { randomUUID } from "node:crypto";
import { defineWebSocketHandler } from "nitro";
import { authorizeDocument, type DocumentAccess } from "../../utils/auth";
import {
  appendEventBatches,
  EventAuthorizationError,
  EventConflictError,
  readEventPage,
} from "../../utils/event-store";
import { authenticateBrowserOrigin } from "../../utils/origin-auth";
import {
  documentLeaseScope,
  documentRealtimeChannel,
  documentTopicHub,
  getDocumentTopicBridge,
  getRealtime,
  LeaseAcquireResult,
} from "../../utils/realtime";

const AUTHORIZATION_CACHE_TTL_MS = 15_000;
const MESSAGE_RATE_LIMIT_WINDOW_MS = 10_000;
const MESSAGE_RATE_LIMIT_MAX = 120;
const MAX_MESSAGE_BYTES = 256 * 1024;
const MAX_DOCUMENT_CONNECTIONS = 100;
const CONNECTION_LEASE_TTL_MS = 45_000;

interface MessageRateLimit {
  readonly count: number;
  readonly windowStartedAt: number;
}

const accessFromContext = (
  context: Record<string, unknown>,
): DocumentAccess | null => {
  const value = context.documentAccess;
  if (typeof value !== "object" || value === null) return null;
  const access = value as Partial<DocumentAccess>;
  if (
    typeof access.documentId !== "string" ||
    (access.accessMode !== COLLAB_ACCESS_MODE.Authenticated &&
      access.accessMode !== COLLAB_ACCESS_MODE.Public) ||
    typeof access.canWrite !== "boolean"
  ) {
    return null;
  }
  if (
    access.accessMode === COLLAB_ACCESS_MODE.Authenticated &&
    (typeof access.userId !== "string" || typeof access.role !== "string")
  ) {
    return null;
  }
  if (
    access.accessMode === COLLAB_ACCESS_MODE.Public &&
    (access.userId !== null || access.role !== null || access.canWrite)
  ) {
    return null;
  }
  return access as DocumentAccess;
};

const credentialFromContext = (
  context: Record<string, unknown>,
): CollabCredential | null => {
  const value = context.credential;
  if (typeof value !== "object" || value === null) return null;
  const credential = value as Partial<CollabCredential>;
  if (credential.kind === "public") return { kind: "public" };
  if (
    credential.kind === "access-token" &&
    typeof credential.token === "string" &&
    credential.token.length > 0
  ) {
    return { kind: "access-token", token: credential.token };
  }
  return null;
};

const protocolVersionFromContext = (
  context: Record<string, unknown>,
): SupportedCollabProtocolVersion =>
  context.protocolVersion === LEGACY_COLLAB_PROTOCOL_VERSION
    ? LEGACY_COLLAB_PROTOCOL_VERSION
    : COLLAB_PROTOCOL_VERSION;

const authorizationExpiresAtFromContext = (
  context: Record<string, unknown>,
): number => {
  const value = context.authorizationExpiresAt;
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
};

const authenticationPendingFromContext = (
  context: Record<string, unknown>,
): boolean => context.authenticationPending === true;

const cacheDocumentAccess = (
  context: Record<string, unknown>,
  access: DocumentAccess,
): void => {
  context.documentAccess = access;
  context.authorizationExpiresAt = Date.now() + AUTHORIZATION_CACHE_TTL_MS;
};

const invalidateDocumentAccess = (context: Record<string, unknown>): void => {
  delete context.documentAccess;
  delete context.authorizationExpiresAt;
};

const stringFromContext = (
  context: Record<string, unknown>,
  key: string,
): string | null => {
  const value = context[key];
  return typeof value === "string" && value.length > 0 ? value : null;
};

const releaseDocumentResources = async (
  context: Record<string, unknown>,
): Promise<void> => {
  const unsubscribeLocal = context.unsubscribeLocal;
  if (typeof unsubscribeLocal === "function") {
    (unsubscribeLocal as () => void)();
    delete context.unsubscribeLocal;
  }
  const channel = stringFromContext(context, "realtimeChannel");
  if (channel !== null) {
    try {
      await getDocumentTopicBridge().release(channel);
    } catch (error) {
      logRouteError(
        error,
        stringFromContext(context, "countedDocumentId"),
        "bridge-release",
      );
    }
    delete context.realtimeChannel;
  }
  const documentId = stringFromContext(context, "countedDocumentId");
  const connectionId = stringFromContext(context, "connectionId");
  if (
    documentId !== null &&
    connectionId !== null &&
    context.connectionCounted === true
  ) {
    try {
      await getRealtime().leases.release(
        documentLeaseScope(documentId),
        connectionId,
      );
    } catch (error) {
      logRouteError(error, documentId, "lease-release");
    }
    delete context.connectionCounted;
  }
};

const consumeMessageQuota = (context: Record<string, unknown>): boolean => {
  const now = Date.now();
  const stored = context.messageRateLimit;
  const current =
    typeof stored === "object" &&
    stored !== null &&
    typeof (stored as Partial<MessageRateLimit>).count === "number" &&
    typeof (stored as Partial<MessageRateLimit>).windowStartedAt === "number"
      ? (stored as MessageRateLimit)
      : null;

  if (
    current === null ||
    now - current.windowStartedAt >= MESSAGE_RATE_LIMIT_WINDOW_MS
  ) {
    context.messageRateLimit = { count: 1, windowStartedAt: now };
    return true;
  }
  if (current.count >= MESSAGE_RATE_LIMIT_MAX) return false;

  context.messageRateLimit = { ...current, count: current.count + 1 };
  return true;
};

const logRouteError = (
  error: unknown,
  documentId: string | null,
  messageType: string,
): void => {
  console.error("Collaboration request failed", {
    documentId,
    messageType,
    errorName: error instanceof Error ? error.name : "UnknownError",
  });
};

const errorMessage = (
  code: CollabErrorCode,
  message: string,
  retryable: boolean,
  protocolVersion: SupportedCollabProtocolVersion = COLLAB_PROTOCOL_VERSION,
) => ({
  protocolVersion,
  type: COLLAB_MESSAGE_TYPE.Error,
  code,
  message,
  retryable,
});

export default defineWebSocketHandler({
  async upgrade(request) {
    // Shallow mutable copy: Origin auth returns a frozen object, but peer
    // handlers need to attach timers and delete authorizationRecheckPending.
    const context = { ...authenticateBrowserOrigin(request) };
    return { namespace: "softmaple-collab-v3", context };
  },

  async message(peer, rawMessage) {
    const rawText = rawMessage.text();
    if (new TextEncoder().encode(rawText).byteLength > MAX_MESSAGE_BYTES) {
      peer.close(1009, "Collaboration message is too large");
      return;
    }
    if (!consumeMessageQuota(peer.context)) {
      peer.send(
        errorMessage(
          COLLAB_ERROR_CODE.InvalidMessage,
          "Too many collaboration messages",
          true,
          protocolVersionFromContext(peer.context),
        ),
      );
      peer.close(1013, "Message rate limit exceeded");
      return;
    }

    let message;
    try {
      message = parseClientCollabMessage(JSON.parse(rawText));
    } catch (error) {
      logRouteError(
        error,
        accessFromContext(peer.context)?.documentId ?? null,
        "unknown",
      );
      peer.send(
        errorMessage(
          COLLAB_ERROR_CODE.InvalidMessage,
          "The collaboration message is invalid",
          false,
          protocolVersionFromContext(peer.context),
        ),
      );
      return;
    }

    if (message.type === COLLAB_MESSAGE_TYPE.Auth) {
      const alreadyAuthenticated = accessFromContext(peer.context) !== null;
      if (
        alreadyAuthenticated ||
        authenticationPendingFromContext(peer.context)
      ) {
        peer.close(
          1008,
          alreadyAuthenticated
            ? "Already authenticated"
            : "Authentication already in progress",
        );
        return;
      }
      peer.context.authenticationPending = true;
      try {
        const credential: CollabCredential =
          message.protocolVersion === LEGACY_COLLAB_PROTOCOL_VERSION
            ? { kind: "access-token", token: message.accessToken }
            : message.credential;
        const access = await authorizeDocument(credential, message.documentId);
        if (access === null) {
          peer.send(
            errorMessage(
              COLLAB_ERROR_CODE.AuthenticationFailed,
              "Authentication or document membership failed",
              false,
              message.protocolVersion,
            ),
          );
          peer.close(1008, "Unauthorized");
          return;
        }
        if (
          message.protocolVersion === LEGACY_COLLAB_PROTOCOL_VERSION &&
          access.accessMode !== COLLAB_ACCESS_MODE.Authenticated
        ) {
          peer.close(1008, "Legacy public collaboration is unsupported");
          return;
        }

        const connectionId = randomUUID();
        const leaseResult = await getRealtime().leases.tryAcquire(
          documentLeaseScope(access.documentId),
          connectionId,
          MAX_DOCUMENT_CONNECTIONS,
          CONNECTION_LEASE_TTL_MS,
        );
        if (leaseResult !== LeaseAcquireResult.Acquired) {
          peer.send(
            errorMessage(
              COLLAB_ERROR_CODE.Forbidden,
              "This document has reached its connection limit",
              true,
              message.protocolVersion,
            ),
          );
          peer.close(1013, "Document connection limit reached");
          return;
        }

        const channel = documentRealtimeChannel(
          access.documentId,
          message.protocolVersion,
        );
        peer.context.connectionCounted = true;
        peer.context.countedDocumentId = access.documentId;
        peer.context.connectionId = connectionId;
        peer.context.realtimeChannel = channel;
        peer.context.unsubscribeLocal = documentTopicHub.subscribe(
          channel,
          peer,
        );
        await getDocumentTopicBridge().retain(channel);

        cacheDocumentAccess(peer.context, access);
        peer.context.credential = credential;
        peer.context.protocolVersion = message.protocolVersion;
        peer.context.sessionId = message.sessionId;
        peer.context.authorizationRecheckTimer = setInterval(() => {
          if (peer.context.authorizationRecheckPending === true) return;
          peer.context.authorizationRecheckPending = true;
          void Promise.all([
            authorizeDocument(credential, access.documentId),
            getRealtime().leases.refresh(
              documentLeaseScope(access.documentId),
              connectionId,
              CONNECTION_LEASE_TTL_MS,
            ),
          ])
            .then(([reauthorized, leaseAlive]) => {
              const current = accessFromContext(peer.context);
              if (
                current === null ||
                reauthorized === null ||
                reauthorized.accessMode !== current.accessMode ||
                reauthorized.userId !== current.userId ||
                !leaseAlive
              ) {
                invalidateDocumentAccess(peer.context);
                peer.close(1008, "Collaboration access was revoked");
                return;
              }
              cacheDocumentAccess(peer.context, reauthorized);
            })
            .catch((error: unknown) => {
              logRouteError(error, access.documentId, "authorization-recheck");
              peer.close(1011, "Authorization recheck failed");
            })
            .finally(() => {
              delete peer.context.authorizationRecheckPending;
            });
        }, AUTHORIZATION_CACHE_TTL_MS);
        peer.send(
          message.protocolVersion === LEGACY_COLLAB_PROTOCOL_VERSION
            ? {
                protocolVersion: LEGACY_COLLAB_PROTOCOL_VERSION,
                type: COLLAB_MESSAGE_TYPE.Ready,
                documentId: access.documentId,
                userId: access.userId,
                role: access.role,
                canWrite: access.canWrite,
              }
            : {
                protocolVersion: COLLAB_PROTOCOL_VERSION,
                type: COLLAB_MESSAGE_TYPE.Ready,
                accessMode: access.accessMode,
                documentId: access.documentId,
                userId: access.userId,
                role: access.role,
                canWrite: access.canWrite,
              },
        );
      } catch (error) {
        invalidateDocumentAccess(peer.context);
        await releaseDocumentResources(peer.context);
        logRouteError(error, message.documentId, message.type);
        peer.send(
          errorMessage(
            COLLAB_ERROR_CODE.AuthenticationFailed,
            "Authentication is temporarily unavailable",
            true,
            message.protocolVersion,
          ),
        );
      } finally {
        delete peer.context.authenticationPending;
      }
      return;
    }

    const access = accessFromContext(peer.context);
    if (access === null) {
      peer.send(
        errorMessage(
          COLLAB_ERROR_CODE.AuthenticationFailed,
          "Authenticate before sending collaboration messages",
          false,
          protocolVersionFromContext(peer.context),
        ),
      );
      return;
    }

    const credential = credentialFromContext(peer.context);
    if (credential === null) {
      peer.send(
        errorMessage(
          COLLAB_ERROR_CODE.AuthenticationFailed,
          "The collaboration session is invalid",
          false,
          protocolVersionFromContext(peer.context),
        ),
      );
      peer.close(1008, "Unauthorized");
      return;
    }

    let currentAccess = access;
    if (authorizationExpiresAtFromContext(peer.context) <= Date.now()) {
      try {
        const reauthorized = await authorizeDocument(
          credential,
          access.documentId,
        );
        if (
          reauthorized === null ||
          reauthorized.accessMode !== access.accessMode ||
          reauthorized.userId !== access.userId
        ) {
          invalidateDocumentAccess(peer.context);
          peer.send(
            errorMessage(
              COLLAB_ERROR_CODE.AuthenticationFailed,
              "Authentication or document membership failed",
              false,
              protocolVersionFromContext(peer.context),
            ),
          );
          peer.close(1008, "Unauthorized");
          return;
        }
        currentAccess = reauthorized;
        cacheDocumentAccess(peer.context, currentAccess);
      } catch (error) {
        invalidateDocumentAccess(peer.context);
        logRouteError(error, access.documentId, message.type);
        peer.send(
          errorMessage(
            COLLAB_ERROR_CODE.AuthenticationFailed,
            "Authentication is temporarily unavailable",
            true,
            protocolVersionFromContext(peer.context),
          ),
        );
        peer.close(1011, "Authentication unavailable");
        return;
      }
    }

    if (message.type === COLLAB_MESSAGE_TYPE.RepairRequest) {
      try {
        const page = await readEventPage(
          currentAccess.documentId,
          message.afterCursor,
        );
        peer.send({
          protocolVersion: protocolVersionFromContext(peer.context),
          type: COLLAB_MESSAGE_TYPE.RepairResponse,
          requestId: message.requestId,
          ...page,
        });
      } catch (error) {
        logRouteError(error, currentAccess.documentId, message.type);
        peer.send(
          errorMessage(
            COLLAB_ERROR_CODE.PersistenceFailed,
            "Document history could not be loaded",
            true,
            protocolVersionFromContext(peer.context),
          ),
        );
      }
      return;
    }

    if (message.type === COLLAB_MESSAGE_TYPE.Event) {
      if (!currentAccess.canWrite) {
        peer.send(
          errorMessage(
            COLLAB_ERROR_CODE.Forbidden,
            "This workspace role cannot edit documents",
            false,
            protocolVersionFromContext(peer.context),
          ),
        );
        return;
      }
      if (currentAccess.accessMode !== COLLAB_ACCESS_MODE.Authenticated) {
        peer.send(
          errorMessage(
            COLLAB_ERROR_CODE.Forbidden,
            "Public document sessions are read-only",
            false,
            protocolVersionFromContext(peer.context),
          ),
        );
        return;
      }
      let batchIds: ReadonlyArray<string>;
      try {
        batchIds = await appendEventBatches(
          currentAccess.documentId,
          currentAccess.userId,
          message.batches,
        );
      } catch (error) {
        logRouteError(error, currentAccess.documentId, message.type);
        const conflict = error instanceof EventConflictError;
        const forbidden = error instanceof EventAuthorizationError;
        peer.send(
          errorMessage(
            forbidden
              ? COLLAB_ERROR_CODE.Forbidden
              : conflict
                ? COLLAB_ERROR_CODE.Conflict
                : COLLAB_ERROR_CODE.PersistenceFailed,
            forbidden
              ? "This workspace role cannot edit documents"
              : conflict
                ? "The event batch conflicts with stored document history"
                : "The event batch was not saved",
            !conflict && !forbidden,
            protocolVersionFromContext(peer.context),
          ),
        );
        return;
      }

      // Persist before publish: never fan out a batch that failed durably.
      peer.send({
        protocolVersion: protocolVersionFromContext(peer.context),
        type: COLLAB_MESSAGE_TYPE.DurableAck,
        batchIds,
      });
      for (const protocolVersion of [
        LEGACY_COLLAB_PROTOCOL_VERSION,
        COLLAB_PROTOCOL_VERSION,
      ] as const) {
        try {
          await getRealtime().bus.publish(
            documentRealtimeChannel(currentAccess.documentId, protocolVersion),
            {
              protocolVersion,
              type: COLLAB_MESSAGE_TYPE.Event,
              batches: message.batches,
            },
          );
        } catch (error) {
          // Durable write already succeeded; peers recover via repair/resync.
          logRouteError(error, currentAccess.documentId, "realtime-publish");
        }
      }
    }
  },

  async close(peer) {
    const authorizationRecheckTimer = peer.context.authorizationRecheckTimer;
    if (authorizationRecheckTimer !== undefined) {
      clearInterval(
        authorizationRecheckTimer as ReturnType<typeof setInterval>,
      );
    }
    await releaseDocumentResources(peer.context);
  },
});
