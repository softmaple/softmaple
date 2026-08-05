import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: [
      {
        find: "@softmaple/eg-walker/anchors",
        replacement: fileURLToPath(
          new URL("../eg-walker/src/anchors.ts", import.meta.url),
        ),
      },
      {
        find: "@softmaple/eg-walker",
        replacement: fileURLToPath(
          new URL("../eg-walker/src/index.ts", import.meta.url),
        ),
      },
    ],
  },
  test: {
    environment: "node",
  },
});
