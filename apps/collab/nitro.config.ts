import { defineNitroConfig } from "nitro/config";

export default defineNitroConfig({
  features: {
    websocket: true,
  },
  serverDir: "./server",
  typescript: {
    strict: true,
  },
});
