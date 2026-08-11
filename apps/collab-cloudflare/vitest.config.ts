import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      main: "./test/worker.ts",
      miniflare: {
        bindings: {
          COLLAB_ALLOWED_ORIGINS: "https://app.example",
          SUPABASE_PUBLISHABLE_KEY: "test-publishable-key",
          SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
          SUPABASE_URL: "https://example.supabase.co",
        },
        durableObjects: {
          DOCUMENT_ROOMS: "TestDocumentRoomDO",
        },
      },
      wrangler: { configPath: "./wrangler.jsonc" },
    }),
  ],
});
