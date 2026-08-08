/**
 * Document sync WebSocket (protocol v2).
 *
 * First client frame must be `auth` (token not in URL). After DB commit the
 * server broadcasts `event` and sends `durable-ack`.
 */

import { defineWebSocketHandler } from "nitro";
import type { EventHandler } from "nitro/h3";
import {
  COLLAB_PROTOCOL_VERSION,
  ClientCollabMessageSchema,
  CollabErrorCode,
  CollabMessageType,
  CollabProtocolError,
  DEFAULT_REPAIR_PAGE_SIZE,
  MAX_REPAIR_PAGE_SIZE,
} from "@softmaple/collab-protocol";
import {
  authenticateDocumentAccess,
  type AuthContext,
} from "../../auth/verify";
import {
  appendEventBatch,
  listEventBatchesAfter,
} from "../../repository/event-batches";
import { getPrisma } from "../../utils/prisma";

type PeerContext = {
  documentId?: string;
  replicaId?: string;
  auth?: AuthContext;
  topic?: string;
};

const documentTopic = (documentId: string): string => `document:${documentId}`;

const sendJson = (
  peer: { send: (data: unknown) => void },
  message: unknown,
): void => {
  try {
    peer.send(message);
  } catch {
    // Peer may already be closed.
  }
};

const sendError = (
  peer: { send: (data: unknown) => void },
  error: unknown,
  documentId?: string,
): void => {
  if (error instanceof CollabProtocolError) {
    sendJson(peer, {
      protocolVersion: COLLAB_PROTOCOL_VERSION,
      type: CollabMessageType.Error,
      documentId,
      senderId: "server",
      code: error.code,
      message: error.message,
      details: error.details,
    });
    return;
  }
  sendJson(peer, {
    protocolVersion: COLLAB_PROTOCOL_VERSION,
    type: CollabMessageType.Error,
    documentId,
    senderId: "server",
    code: CollabErrorCode.Internal,
    message: error instanceof Error ? error.message : "Internal error",
  });
};

const handler: EventHandler = defineWebSocketHandler({
  async message(peer, message) {
    const context = peer.context as PeerContext;
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(message.text());
    } catch {
      sendError(
        peer,
        new CollabProtocolError(
          CollabErrorCode.InvalidMessage,
          "Message must be JSON",
        ),
      );
      return;
    }

    const parsed = ClientCollabMessageSchema.safeParse(parsedJson);
    if (!parsed.success) {
      sendError(
        peer,
        new CollabProtocolError(
          CollabErrorCode.InvalidMessage,
          parsed.error.message,
        ),
        context.documentId,
      );
      return;
    }

    const msg = parsed.data;
    const prisma = getPrisma();

    try {
      switch (msg.type) {
        case CollabMessageType.Auth: {
          const auth = await authenticateDocumentAccess(
            prisma,
            msg.accessToken,
            msg.documentId,
          );
          if (context.topic) peer.unsubscribe(context.topic);
          const topic = documentTopic(msg.documentId);
          context.documentId = msg.documentId;
          context.replicaId = msg.replicaId;
          context.auth = auth;
          context.topic = topic;
          peer.subscribe(topic);
          sendJson(peer, {
            protocolVersion: COLLAB_PROTOCOL_VERSION,
            type: CollabMessageType.AuthOk,
            documentId: msg.documentId,
            senderId: "server",
            userId: auth.userId,
            role: auth.role,
            canWrite: auth.canWrite,
          });
          return;
        }
        case CollabMessageType.Reauth: {
          if (!context.documentId) {
            throw new CollabProtocolError(
              CollabErrorCode.NotAuthenticated,
              "Authenticate before reauth",
            );
          }
          const documentId = context.documentId;
          const topic = context.topic;
          // Drop authorization until reauth succeeds.
          context.auth = undefined;
          if (topic) {
            peer.unsubscribe(topic);
            context.topic = undefined;
          }
          const auth = await authenticateDocumentAccess(
            prisma,
            msg.accessToken,
            documentId,
          );
          context.auth = auth;
          const restoredTopic = documentTopic(documentId);
          context.topic = restoredTopic;
          peer.subscribe(restoredTopic);
          sendJson(peer, {
            protocolVersion: COLLAB_PROTOCOL_VERSION,
            type: CollabMessageType.AuthOk,
            documentId,
            senderId: "server",
            userId: auth.userId,
            role: auth.role,
            canWrite: auth.canWrite,
          });
          return;
        }
        case CollabMessageType.Event: {
          const auth = context.auth;
          if (!auth || !context.replicaId || !context.topic) {
            throw new CollabProtocolError(
              CollabErrorCode.NotAuthenticated,
              "Authenticate before sending events",
            );
          }
          if (msg.documentId !== auth.documentId) {
            throw new CollabProtocolError(
              CollabErrorCode.Forbidden,
              "Document mismatch",
            );
          }
          if (!auth.canWrite) {
            throw new CollabProtocolError(
              CollabErrorCode.ReadOnly,
              "VIEWER cannot write events",
            );
          }
          const result = await appendEventBatch(prisma, {
            documentId: auth.documentId,
            createdBy: auth.userId,
            payload: msg.batch,
          });
          peer.publish(context.topic, {
            protocolVersion: COLLAB_PROTOCOL_VERSION,
            type: CollabMessageType.Event,
            documentId: auth.documentId,
            senderId: context.replicaId,
            batch: result.batch,
          });
          sendJson(peer, {
            protocolVersion: COLLAB_PROTOCOL_VERSION,
            type: CollabMessageType.DurableAck,
            documentId: auth.documentId,
            senderId: "server",
            batchIds: [result.batch.batchId],
            cursors: { [result.batch.batchId]: result.cursor },
          });
          return;
        }
        case CollabMessageType.RepairRequest: {
          const auth = context.auth;
          if (!auth || !context.replicaId) {
            throw new CollabProtocolError(
              CollabErrorCode.NotAuthenticated,
              "Authenticate before repair",
            );
          }
          if (msg.documentId !== auth.documentId) {
            throw new CollabProtocolError(
              CollabErrorCode.Forbidden,
              "Document mismatch",
            );
          }
          const limit = Math.min(
            msg.limit ?? DEFAULT_REPAIR_PAGE_SIZE,
            MAX_REPAIR_PAGE_SIZE,
          );
          const page = await listEventBatchesAfter(
            prisma,
            auth.documentId,
            msg.afterCursor ?? null,
            limit,
          );
          sendJson(peer, {
            protocolVersion: COLLAB_PROTOCOL_VERSION,
            type: CollabMessageType.RepairResponse,
            documentId: auth.documentId,
            senderId: "server",
            requestId: msg.requestId,
            recipientId: context.replicaId,
            batches: page.batches,
            nextCursor: page.nextCursor,
            hasMore: page.hasMore,
          });
          return;
        }
        default:
          return;
      }
    } catch (error) {
      sendError(peer, error, context.documentId);
    }
  },

  close(peer) {
    const context = peer.context as PeerContext;
    if (context.topic) peer.unsubscribe(context.topic);
  },
});

export default handler;
