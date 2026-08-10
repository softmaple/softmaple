import { definePlugin } from "nitro";
import { closeDocumentRoomHost } from "../document-room-host";
import { closeRealtime } from "../utils/realtime";

export default definePlugin((nitroApp) => {
  nitroApp.hooks.hook("close", async () => {
    await closeDocumentRoomHost();
    await closeRealtime();
  });
});
