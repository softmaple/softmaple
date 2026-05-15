import * as path from "node:path";
import { defineConfig } from "vitest/config";

const fromHere = (p: string) => path.resolve(__dirname, p);

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
      // Workspace packages have a `package.json#exports` pointing to `./dist`,
      // but for the playground we resolve them straight to source so a fresh
      // clone never has to build dependent packages before running tests.
      // Keep this list in sync with the matching entries in vite.config.ts.
      "@softmaple/awareness/styles.css": fromHere(
        "../../packages/awareness/src/global.css",
      ),
      "@softmaple/awareness": fromHere(
        "../../packages/awareness/src/index.ts",
      ),
      "@softmaple/eg-walker": fromHere(
        "../../packages/eg-walker/src/index.ts",
      ),
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
