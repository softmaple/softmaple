import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "nitro";

const appDirectory = fileURLToPath(new URL(".", import.meta.url));

// Local development reuses the ignored Prisma environment file. Deployed
// environments must provide these variables through their secret manager.
loadEnv({
  path: [
    resolve(appDirectory, ".env.local"),
    resolve(appDirectory, "../../packages/db/.env"),
  ],
});

export default defineConfig({
  serverDir: "./server",
  features: {
    websocket: true,
  },
});
