import { definePlugin } from "nitro";
import { closeRealtime } from "../utils/realtime";

export default definePlugin((nitroApp) => {
  nitroApp.hooks.hook("close", async () => {
    await closeRealtime();
  });
});
