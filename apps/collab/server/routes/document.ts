import {
  COLLAB_ERROR_CODE,
  COLLAB_MESSAGE_TYPE,
  COLLAB_PROTOCOL_VERSION,
  parseClientCollabMessage,
  type CollabErrorCode,
} from "@softmaple/collab-protocol";
import { defineWebSocketHandler } from "nitro";
import { authorizeDocument, type DocumentAccess } from "../utils/auth";
import {
  appendEventBatches,
  EventAuthorizationError,
  EventConflictError,
  readEventPage,
} from "../utils/event-store";

const TOPIC_PREFIX = "document:";

const allowedOrigins = (): ReadonlySet<string> => {
  const configured = process.env.COLLAB_ALLOWED_ORIGINS;
  if (configured) {
    return new Set(
      configured
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean),
    );
  }
  return new Set(["http://localhost:3000", "http://127.0.0.1:3000"]);
};

const topicForDocument = (documentId: string): string =>
  `${TOPIC_PREFIX}${documentId}`;

const accessFromContext = (
  context: Record<string, unknown>,
): DocumentAccess | null => {
  const value = context.documentAccess;
  if (typeof value !== "object" || value === null) return null;
  const access = value as Partial<DocumentAccess>;
  if (
    typeof access.documentId !== "string" ||
    typeof access.userId !== "string" ||
    typeof access.role !== "string" ||
    typeof access.canWrite !== "boolean"
  ) {
    return null;
  }
  return access as DocumentAccess;
};

const accessTokenFromContext = (
  context: Record<string, unknown>,
): string | null => {
  const value = context.accessToken;
  return typeof value === "string" && value.length > 0 ? value : null;
};

const errorMessage = (
  code: CollabErrorCode,
  message: string,
  retryable: boolean,
) => ({
  protocolVersion: COLLAB_PROTOCOL_VERSION,
  type: COLLAB_MESSAGE_TYPE.Error,
  code,
  message,
  retryable,
});

export default defineWebSocketHandler({
  upgrade(request) {
    const origin = request.headers.get("origin");
    if (origin !== null && !allowedOrigins().has(origin)) {
      throw new Response("Origin is not allowed", { status: 403 });
    }
    return { namespace: "softmaple-collab-v2", context: {} };
  },

  async message(peer, rawMessage) {
    let message;
    try {
      message = parseClientCollabMessage(JSON.parse(rawMessage.text()));
    } catch {
      peer.send(
        errorMessage(
          COLLAB_ERROR_CODE.InvalidMessage,
          "The collaboration message is invalid",
          false,
        ),
      );
      return;
    }

    if (message.type === COLLAB_MESSAGE_TYPE.Auth) {
      if (accessFromContext(peer.context) !== null) {
        peer.close(1008, "Already authenticated");
        return;
      }
      try {
        const access = await authorizeDocument(
          message.accessToken,
          message.documentId,
        );
        if (access === null) {
          peer.send(
            errorMessage(
              COLLAB_ERROR_CODE.AuthenticationFailed,
              "Authentication or document membership failed",
              false,
            ),
          );
          peer.close(1008, "Unauthorized");
          return;
        }
        peer.context.documentAccess = access;
        peer.context.accessToken = message.accessToken;
        peer.context.sessionId = message.sessionId;
        peer.subscribe(topicForDocument(access.documentId));
        peer.send({
          protocolVersion: COLLAB_PROTOCOL_VERSION,
          type: COLLAB_MESSAGE_TYPE.Ready,
          documentId: access.documentId,
          userId: access.userId,
          role: access.role,
          canWrite: access.canWrite,
        });
      } catch {
        peer.send(
          errorMessage(
            COLLAB_ERROR_CODE.AuthenticationFailed,
            "Authentication is temporarily unavailable",
            true,
          ),
        );
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
        ),
      );
      return;
    }

    const accessToken = accessTokenFromContext(peer.context);
    if (accessToken === null) {
      peer.send(
        errorMessage(
          COLLAB_ERROR_CODE.AuthenticationFailed,
          "The collaboration session is invalid",
          false,
        ),
      );
      peer.close(1008, "Unauthorized");
      return;
    }

    let currentAccess: DocumentAccess;
    try {
      const reauthorized = await authorizeDocument(
        accessToken,
        access.documentId,
      );
      if (reauthorized === null || reauthorized.userId !== access.userId) {
        peer.send(
          errorMessage(
            COLLAB_ERROR_CODE.AuthenticationFailed,
            "Authentication or document membership failed",
            false,
          ),
        );
        peer.close(1008, "Unauthorized");
        return;
      }
      currentAccess = reauthorized;
      peer.context.documentAccess = currentAccess;
    } catch {
      peer.send(
        errorMessage(
          COLLAB_ERROR_CODE.AuthenticationFailed,
          "Authentication is temporarily unavailable",
          true,
        ),
      );
      peer.close(1011, "Authentication unavailable");
      return;
    }

    if (message.type === COLLAB_MESSAGE_TYPE.RepairRequest) {
      try {
        const page = await readEventPage(
          currentAccess.documentId,
          message.afterCursor,
        );
        peer.send({
          protocolVersion: COLLAB_PROTOCOL_VERSION,
          type: COLLAB_MESSAGE_TYPE.RepairResponse,
          requestId: message.requestId,
          ...page,
        });
      } catch {
        peer.send(
          errorMessage(
            COLLAB_ERROR_CODE.PersistenceFailed,
            "Document history could not be loaded",
            true,
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
          ),
        );
        return;
      }
      try {
        const batchIds = await appendEventBatches(
          currentAccess.documentId,
          currentAccess.userId,
          message.batches,
        );
        peer.send({
          protocolVersion: COLLAB_PROTOCOL_VERSION,
          type: COLLAB_MESSAGE_TYPE.DurableAck,
          batchIds,
        });
        peer.publish(topicForDocument(currentAccess.documentId), {
          protocolVersion: COLLAB_PROTOCOL_VERSION,
          type: COLLAB_MESSAGE_TYPE.Event,
          batches: message.batches,
        });
      } catch (error) {
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
          ),
        );
      }
    }
  },

  close(peer) {
    const access = accessFromContext(peer.context);
    if (access !== null) {
      peer.unsubscribe(topicForDocument(access.documentId));
    }
  },
});
