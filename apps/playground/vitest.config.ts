import * as path from "node:path";
import { defineConfig } from "vitest/config";
import { workspaceAlias } from "./workspace-aliases.ts";

export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["fake-indexeddb/auto"],
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/cypress/**",
      "**/.{idea,git,cache,output,temp}/**",
      "**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress}.config.*",
      "**/e2e/**", // Exclude Playwright E2E tests
      "**/*.spec.ts", // Exclude Playwright spec files
    ],
  },
  resolve: {
    alias: {
      ...workspaceAlias,
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
});
