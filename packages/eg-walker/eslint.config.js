import { config } from "@softmaple/eslint-config/base";
import {
  combinePatterns,
  egWalkerCollaborationPatterns,
} from "@softmaple/eslint-config/collaboration-layers";

const ENGINE_INTERNALS_PATTERNS = [
  {
    group: ["**/engine/internals/*", "**/engine/internals/**"],
    message:
      "engine/internals/* is private to the engine layer. Import from engine/ or expose a stable name via src/internal.ts instead.",
  },
];

export default [
  ...config,
  {
    // Collaboration-architecture layering rules (see
    // docs/design/collaboration-layers.md). Applies to all sources in
    // this package; the more specific block below merges these
    // patterns with the engine-internals boundary for core/graph.
    files: ["src/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: egWalkerCollaborationPatterns },
      ],
    },
  },
  {
    // Core and graph layers additionally must not reach into
    // engine/internals/*. `combinePatterns` re-applies the eg-walker
    // collaboration patterns alongside the engine-internals boundary
    // because flat-config rule reconfiguration replaces — it does not
    // concat — when the same rule fires again.
    files: ["src/core/**/*.ts", "src/graph/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: combinePatterns(
            egWalkerCollaborationPatterns,
            ENGINE_INTERNALS_PATTERNS,
          ),
        },
      ],
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
