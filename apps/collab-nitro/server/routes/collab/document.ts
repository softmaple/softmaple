import { defineWebSocketHandler } from "nitro";
import {
  closeNitroDocumentHost,
  getNitroDocumentHost,
} from "../../adapters/nitro-document-host";
import { authenticateBrowserOrigin } from "../../utils/origin-auth";

export default defineWebSocketHandler({
  async upgrade(request) {
    const context = { ...authenticateBrowserOrigin(request) };
    return { namespace: "softmaple-collab-v3", context };
  },

  async message(peer, rawMessage) {
    await getNitroDocumentHost(peer).receiveText(rawMessage.text());
  },

  async close(peer) {
    await closeNitroDocumentHost(peer);
  },
});
