import {
  COLLAB_ERROR_CODE,
  COLLAB_MESSAGE_TYPE,
  COLLAB_PROTOCOL_VERSION,
  parseClientCollabMessage,
  type CollabErrorCode,
  type SupportedCollabProtocolVersion,
} from "@softmaple/collab-protocol";
import { defineWebSocketHandler } from "nitro";
import { logDocumentRoomError } from "../../adapters/document-room-logging";
import { toNitroRoomPeer } from "../../adapters/nitro-room-peer";
import { getDocumentRoomHost } from "../../document-room-host";
import { authenticateBrowserOrigin } from "../../utils/origin-auth";

const MESSAGE_RATE_LIMIT_WINDOW_MS = 10_000;
const MESSAGE_RATE_LIMIT_MAX = 120;
const MAX_MESSAGE_BYTES = 256 * 1024;

interface MessageRateLimit {
  readonly count: number;
  readonly windowStartedAt: number;
}

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
    // Origin auth returns a frozen object; transport policy stores counters.
    const context = { ...authenticateBrowserOrigin(request) };
    return { namespace: "softmaple-collab-v3", context };
  },

  async message(peer, rawMessage) {
    const roomPeer = toNitroRoomPeer(peer);
    const host = getDocumentRoomHost();
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
          host.protocolVersionFor(roomPeer),
        ),
      );
      peer.close(1013, "Message rate limit exceeded");
      return;
    }

    let message;
    try {
      message = parseClientCollabMessage(JSON.parse(rawText));
    } catch (error) {
      logDocumentRoomError(error, host.documentIdFor(roomPeer), "unknown");
      peer.send(
        errorMessage(
          COLLAB_ERROR_CODE.InvalidMessage,
          "The collaboration message is invalid",
          false,
          host.protocolVersionFor(roomPeer),
        ),
      );
      return;
    }

    try {
      await host.receive(roomPeer, message);
    } catch (error) {
      logDocumentRoomError(error, host.documentIdFor(roomPeer), message.type);
      peer.send(
        errorMessage(
          COLLAB_ERROR_CODE.PersistenceFailed,
          "The collaboration request could not be completed",
          true,
          host.protocolVersionFor(roomPeer),
        ),
      );
      peer.close(1011, "Collaboration handler failed");
    }
  },

  async close(peer) {
    const roomPeer = toNitroRoomPeer(peer);
    const host = getDocumentRoomHost();
    try {
      await host.leave(roomPeer);
    } catch (error) {
      logDocumentRoomError(error, host.documentIdFor(roomPeer), "close");
    }
  },
});
