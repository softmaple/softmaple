import { defineConfig, mergeConfig } from "vitest/config";

import baseConfig from "./vitest.config";

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      fileParallelism: false,
      include: ["src/conformance/reference-conformance.case.ts"],
      testTimeout: 30_000,
    },
  }),
);
