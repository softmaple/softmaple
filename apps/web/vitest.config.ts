import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  // Next.js tsconfig uses jsx: "preserve"; Oxc must transform JSX for Vitest.
  oxc: {
    jsx: {
      runtime: "automatic",
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "**/e2e/**",
      "**/playwright/**",
      "**/*.spec.ts",
    ],
    include: ["**/*.test.ts", "**/*.test.tsx"],
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./"),
    },
  },
});
