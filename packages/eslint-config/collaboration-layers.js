/**
 * Collaboration architecture layering rules.
 *
 * Enforces the boundaries documented in
 * `docs/design/collaboration-layers.md`:
 *
 * - `@softmaple/eg-walker` MUST NOT import `@softmaple/awareness` or any
 *   editor framework (Lexical, ProseMirror, Slate).
 * - `@softmaple/awareness` MUST NOT import `@softmaple/eg-walker` or any
 *   editor framework.
 * - Only `apps/*` may combine the two core packages with a concrete
 *   editor framework.
 *
 * @module @softmaple/eslint-config/collaboration-layers
 */

const EG_WALKER_PATTERNS = [
  {
    group: ["@softmaple/eg-walker", "@softmaple/eg-walker/*"],
    message:
      "Cross-layer import: see docs/design/collaboration-layers.md. " +
      "@softmaple/awareness must not depend on @softmaple/eg-walker.",
  },
];

const AWARENESS_PATTERNS = [
  {
    group: ["@softmaple/awareness", "@softmaple/awareness/*"],
    message:
      "Cross-layer import: see docs/design/collaboration-layers.md. " +
      "@softmaple/eg-walker must not depend on @softmaple/awareness.",
  },
];

/**
 * Editor frameworks that the two core collaboration packages
 * (eg-walker, awareness) MUST NOT depend on. See
 * `docs/design/collaboration-layers.md` for the rationale.
 */
export const EDITOR_FRAMEWORK_PATTERNS = [
  {
    group: ["lexical", "lexical/*", "@lexical/*"],
    message:
      "Editor-framework import: see docs/design/collaboration-layers.md. " +
      "Core collaboration packages must be editor-class-agnostic; " +
      "Lexical bindings belong in apps/* or a future bindings sub-path.",
  },
  {
    group: ["prosemirror-*"],
    message:
      "Editor-framework import: see docs/design/collaboration-layers.md. " +
      "Core collaboration packages must be editor-class-agnostic; " +
      "ProseMirror bindings belong in apps/* or a future bindings sub-path.",
  },
  {
    group: ["slate", "slate-*"],
    message:
      "Editor-framework import: see docs/design/collaboration-layers.md. " +
      "Core collaboration packages must be editor-class-agnostic; " +
      "Slate bindings belong in apps/* or a future bindings sub-path.",
  },
];

/**
 * `no-restricted-imports` patterns for `@softmaple/eg-walker`:
 * forbids `@softmaple/awareness` and any editor framework.
 */
export const egWalkerCollaborationPatterns = [
  ...AWARENESS_PATTERNS,
  ...EDITOR_FRAMEWORK_PATTERNS,
];

/**
 * `no-restricted-imports` patterns for `@softmaple/awareness`:
 * forbids `@softmaple/eg-walker` and any editor framework.
 */
export const awarenessCollaborationPatterns = [
  ...EG_WALKER_PATTERNS,
  ...EDITOR_FRAMEWORK_PATTERNS,
];

/**
 * Flat ESLint config block that enforces the eg-walker layering rules
 * on all TypeScript sources in the consuming package.
 *
 * @type {import("eslint").Linter.Config[]}
 */
export const egWalkerCollaborationConfig = [
  {
    files: ["**/*.ts", "**/*.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: egWalkerCollaborationPatterns },
      ],
    },
  },
];

/**
 * Flat ESLint config block that enforces the awareness layering rules
 * on all TypeScript sources in the consuming package.
 *
 * @type {import("eslint").Linter.Config[]}
 */
export const awarenessCollaborationConfig = [
  {
    files: ["**/*.ts", "**/*.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: awarenessCollaborationPatterns },
      ],
    },
  },
];
