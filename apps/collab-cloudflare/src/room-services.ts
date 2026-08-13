import {
  DEFAULT_DOCUMENT_ROOM_POLICY,
  type DocumentEventStore,
  type DocumentRoomServices,
  type DocumentSessionHooks,
} from "@softmaple/collab-runtime";
import {
  createDurableObjectConnectionLimiter,
  createDurableObjectRoomFanout,
} from "./do-capabilities";
import { logError, logMetric } from "./constants";
import { createSupabaseDocumentBackend } from "./supabase-backend";

export interface DocumentBackend {
  readonly events: DocumentEventStore;
  readonly sessions: DocumentSessionHooks;
}

export const createRoomServicesForBackend = (
  documentId: string,
  backend: DocumentBackend,
): DocumentRoomServices => {
  return {
    connections: createDurableObjectConnectionLimiter(),
    events: backend.events,
    fanout: createDurableObjectRoomFanout(),
    metrics: logMetric,
    policy: DEFAULT_DOCUMENT_ROOM_POLICY,
    reportError(error, context) {
      logError(error, {
        documentId: context.documentId,
        messageType: context.messageType,
        peerId: context.peerId,
      });
    },
    sessions: backend.sessions,
  };
};

export const createRoomServices = (
  env: Env,
  documentId: string,
): DocumentRoomServices =>
  createRoomServicesForBackend(documentId, createSupabaseDocumentBackend(env));
