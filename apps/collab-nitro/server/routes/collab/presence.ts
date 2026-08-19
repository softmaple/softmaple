import { defineWebSocketHandler } from "nitro";
import {
  closeNitroPresenceHost,
  getNitroPresenceHost,
} from "../../adapters/nitro-presence-host";
import { authenticateBrowserOrigin } from "../../utils/origin-auth";

const DOCUMENT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default defineWebSocketHandler({
  upgrade(request) {
    const originContext = authenticateBrowserOrigin(request);
    const roomId = new URL(request.url).searchParams.get("roomId");
    if (roomId === null || !DOCUMENT_ID_PATTERN.test(roomId)) {
      throw new Response("Invalid presence room", { status: 400 });
    }
    return {
      namespace: "softmaple-presence-v2",
      context: { ...originContext, roomId },
    };
  },

  async message(peer, rawMessage) {
    const roomId = peer.context.roomId;
    if (typeof roomId !== "string") {
      peer.close(1008, "Presence room mismatch");
      return;
    }
    await getNitroPresenceHost(peer, roomId).receiveText(rawMessage.text());
  },

  async close(peer) {
    await closeNitroPresenceHost(peer);
  },
});
