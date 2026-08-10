import {
  COLLAB_MESSAGE_TYPE,
  COLLAB_PROTOCOL_VERSION,
  LEGACY_COLLAB_PROTOCOL_VERSION,
  parseServerCollabMessage,
} from "@softmaple/collab-protocol";
import type { RoomFanout } from "@softmaple/collab-runtime";
import {
  documentRealtimeChannel,
  documentTopicHub,
  getDocumentTopicBridge,
  getRealtime,
  type LocalTopicHub,
  type RealtimeBus,
  type RealtimePeer,
  type TopicBridge,
} from "../utils/realtime";
import { logDocumentRoomError } from "./document-room-logging";

export interface RealtimeRoomFanoutDependencies {
  readonly bridge: TopicBridge;
  readonly bus: RealtimeBus;
  readonly hub: LocalTopicHub;
}

export const createRealtimeRoomFanout = ({
  bridge,
  bus,
  hub,
}: RealtimeRoomFanoutDependencies): RoomFanout => ({
  async publish(event) {
    for (const protocolVersion of [
      LEGACY_COLLAB_PROTOCOL_VERSION,
      COLLAB_PROTOCOL_VERSION,
    ] as const) {
      try {
        // Keep the Redis payload byte-for-byte compatible with the browser
        // ServerEventMessage relayed by hosts during a rolling deployment.
        await bus.publish(
          documentRealtimeChannel(event.documentId, protocolVersion),
          {
            protocolVersion,
            type: COLLAB_MESSAGE_TYPE.Event,
            batches: event.batches,
          },
        );
      } catch (error) {
        logDocumentRoomError(error, event.documentId, "realtime-publish");
      }
    }
  },
  async subscribe(documentId, handler) {
    // Every current publisher writes both versions. New rooms consume v3 as
    // the canonical channel and translate to each local peer's session version.
    const channel = documentRealtimeChannel(
      documentId,
      COLLAB_PROTOCOL_VERSION,
    );
    const localPeer: RealtimePeer = {
      send(payload) {
        try {
          const message = parseServerCollabMessage(payload);
          if (message.type !== COLLAB_MESSAGE_TYPE.Event) return;
          void Promise.resolve(
            handler({ documentId, batches: message.batches }),
          ).catch((error: unknown) => {
            logDocumentRoomError(error, documentId, "realtime-delivery");
          });
        } catch (error) {
          logDocumentRoomError(error, documentId, "realtime-delivery");
        }
      },
    };
    const unsubscribeLocal = hub.subscribe(channel, localPeer);
    try {
      await bridge.retain(channel);
    } catch (error) {
      unsubscribeLocal();
      logDocumentRoomError(error, documentId, "bridge-retain");
      throw error;
    }

    let unsubscribed = false;
    return {
      async unsubscribe() {
        if (unsubscribed) return;
        unsubscribed = true;
        unsubscribeLocal();
        try {
          await bridge.release(channel);
        } catch (error) {
          logDocumentRoomError(error, documentId, "bridge-release");
          throw error;
        }
      },
    };
  },
});

export const createRedisRoomFanout = (): RoomFanout =>
  createRealtimeRoomFanout({
    bridge: getDocumentTopicBridge(),
    bus: getRealtime().bus,
    hub: documentTopicHub,
  });
