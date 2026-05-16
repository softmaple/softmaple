import { config } from "@softmaple/eslint-config/base";

const ENGINE_INTERNALS_BOUNDARY = {
  patterns: [
    {
      group: ["**/engine/internals/*", "**/engine/internals/**"],
      message:
        "engine/internals/* is private to the engine layer. Import from engine/ or expose a stable name via src/internal.ts instead.",
    },
  ],
};

export default [
  ...config,
  {
    files: ["src/core/**/*.ts", "src/graph/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", ENGINE_INTERNALS_BOUNDARY],
    },
  },
  {
    files: ["src/test/**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
    },
  },
];
