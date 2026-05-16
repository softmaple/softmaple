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
        "src/bench/**",
        "src/**/*.test.ts",
        "src/**/*.bench.ts",
        "src/**/*.spec.ts",
        "src/**/*.d.ts",
        "src/**/index.ts",
      ],
      thresholds: {
        lines: 93.8,
        functions: 97,
        branches: 82.9,
        statements: 93.8,
      },
    },
  },
});
