import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html", "json-summary"],
      include: ["src/**/*.ts"],
      exclude: [
        "src/test/**",
        "src/**/*.test.ts",
        "src/**/*.spec.ts",
        "src/**/index.ts",
        "src/types/compat.ts",
        "src/constants/algorithm-config.ts",
        "src/constants/error-codes.ts",
        "src/constants/sentinels.ts",
        "src/constants/version-relations.ts",
        "src/constants/walker-states.ts",
      ],
      thresholds: {
          lines: 93.9,
          functions: 97,
          branches: 82.9,
          statements: 93.9,
        },
      },
  },
});
