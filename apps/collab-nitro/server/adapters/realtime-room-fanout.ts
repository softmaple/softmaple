import {
  COLLAB_MESSAGE_TYPE,
  COLLAB_PROTOCOL_VERSION,
  LEGACY_COLLAB_PROTOCOL_VERSION,
  parseServerCollabMessage,
} from "@softmaple/collab-protocol";
import type {
  CommittedDocumentEvent,
  RoomFanout,
} from "@softmaple/collab-runtime";
import { documentRealtimeChannel, getRealtime } from "../utils/realtime";

const logPublishError = (
  error: unknown,
  documentId: string,
  protocolVersion: number,
): void => {
  console.error("Collaboration request failed", {
    documentId,
    messageType: "realtime-publish",
    protocolVersion,
    errorName: error instanceof Error ? error.name : "UnknownError",
    errorMessage: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
};

const committedEventFromPayload = (
  documentId: string,
  payload: unknown,
): CommittedDocumentEvent | null => {
  try {
    const message = parseServerCollabMessage(payload);
    if (
      message.protocolVersion !== COLLAB_PROTOCOL_VERSION ||
      message.type !== COLLAB_MESSAGE_TYPE.Event
    ) {
      return null;
    }
    return { documentId, batches: message.batches };
  } catch (error) {
    console.warn("Collaboration realtime payload was ignored", {
      documentId,
      messageType: "realtime-parse",
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return null;
  }
};

/**
 * Compatibility bridge for the existing Redis channel layout.
 *
 * Every old host publishes a v3 event regardless of the writer's protocol, so
 * subscribing only to v3 yields one runtime event per old-host commit. Publish
 * still targets both old wire channels so v2/v3 peers and rolling deployments
 * remain interoperable.
 */
export const realtimeRoomFanout: RoomFanout = {
  async publish(event) {
    for (const protocolVersion of [
      LEGACY_COLLAB_PROTOCOL_VERSION,
      COLLAB_PROTOCOL_VERSION,
    ] as const) {
      try {
        await getRealtime().bus.publish(
          documentRealtimeChannel(event.documentId, protocolVersion),
          {
            protocolVersion,
            type: COLLAB_MESSAGE_TYPE.Event,
            batches: event.batches,
          },
        );
      } catch (error) {
        // The durable append already succeeded. Other peers repair on resync.
        logPublishError(error, event.documentId, protocolVersion);
      }
    }
  },

  async subscribe(documentId, handler) {
    const unsubscribe = await getRealtime().bus.subscribe(
      documentRealtimeChannel(documentId, COLLAB_PROTOCOL_VERSION),
      async (payload) => {
        const event = committedEventFromPayload(documentId, payload);
        if (event !== null) await handler(event);
      },
    );
    let subscribed = true;
    return {
      async unsubscribe() {
        if (!subscribed) return;
        subscribed = false;
        await unsubscribe();
      },
    };
  },
};
