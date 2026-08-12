import type { PresenceFanout } from "@softmaple/collab-runtime";
import {
  getPresenceTopicBridge,
  getRealtime,
  presenceRealtimeChannel,
  presenceTopicHub,
} from "../utils/realtime";

const logForwardError = (roomId: string, error: unknown): void => {
  console.error("Collaboration request failed", {
    roomId,
    messageType: "presence-fanout",
    errorName: error instanceof Error ? error.name : "UnknownError",
    errorMessage: error instanceof Error ? error.message : String(error),
  });
};

/**
 * Redis/memory presence broadcast behind the runtime fan-out port. The room
 * is the single fan-out subscriber per room instance, so this registers one
 * forwarder in `presenceTopicHub` per `subscribe` call and ref-counts the
 * underlying channel through `getPresenceTopicBridge()`.
 */
export const realtimePresenceFanout: PresenceFanout = {
  async publish(broadcast) {
    await getRealtime().bus.publish(
      presenceRealtimeChannel(broadcast.roomId),
      broadcast.frame,
    );
  },

  async subscribe(roomId, handler) {
    const channel = presenceRealtimeChannel(roomId);
    const unsubscribeLocal = presenceTopicHub.subscribe(channel, {
      send(payload) {
        void Promise.resolve(handler({ frame: payload, roomId })).catch(
          (error: unknown) => {
            logForwardError(roomId, error);
          },
        );
      },
    });
    await getPresenceTopicBridge().retain(channel);
    let subscribed = true;
    return {
      async unsubscribe() {
        if (!subscribed) return;
        subscribed = false;
        unsubscribeLocal();
        await getPresenceTopicBridge().release(channel);
      },
    };
  },
};
