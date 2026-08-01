import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: [
      {
        find: "@softmaple/eg-walker/anchors",
        replacement: new URL("../eg-walker/src/anchors.ts", import.meta.url)
          .pathname,
      },
      {
        find: "@softmaple/eg-walker",
        replacement: new URL("../eg-walker/src/index.ts", import.meta.url)
          .pathname,
      },
    ],
  },
  test: {
    environment: "node",
  },
});
