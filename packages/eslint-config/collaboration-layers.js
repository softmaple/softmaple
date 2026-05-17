/**
 * Collaboration architecture layering rules.
 *
 * Enforces the boundaries documented in
 * `docs/design/collaboration-layers.md`:
 *
 * - `@softmaple/eg-walker` MUST NOT import `@softmaple/awareness` or any
 *   editor framework (Lexical, ProseMirror, Slate).
 * - `@softmaple/awareness` MUST NOT import `@softmaple/eg-walker` or any
 *   editor framework. The awareness package enforces this via Biome's
 *   `style/noRestrictedImports` in `packages/awareness/biome.jsonc` —
 *   if you change the deny list below, mirror the change there.
 * - Only `apps/*` may combine the two core packages with a concrete
 *   editor framework.
 *
 * @module @softmaple/eslint-config/collaboration-layers
 */

const AWARENESS_PATTERNS = [
  {
    group: ["@softmaple/awareness", "@softmaple/awareness/*"],
    message:
      "Cross-layer import: see docs/design/collaboration-layers.md. " +
      "@softmaple/eg-walker must not depend on @softmaple/awareness.",
  },
];

/**
 * Editor frameworks that `@softmaple/eg-walker` MUST NOT depend on.
 * The awareness package mirrors this list in its own `biome.jsonc`
 * because it does not run ESLint — keep them in sync when changing
 * either side (see `docs/design/collaboration-layers.md`).
 *
 * Not exported: nothing outside this module needs it, and dropping
 * the export keeps the public surface of `@softmaple/eslint-config`
 * minimal.
 */
const EDITOR_FRAMEWORK_PATTERNS = [
  {
    // Subpath siblings (`@lexical/*/**`, `prosemirror-*/**`,
    // `slate-*/**`) are required because minimatch's `*` does not cross
    // `/`, so e.g. `@lexical/*` would miss `@lexical/react/LexicalComposer`.
    group: ["lexical", "lexical/**", "@lexical/*", "@lexical/*/**"],
    message:
      "Editor-framework import: see docs/design/collaboration-layers.md. " +
      "Core collaboration packages must be editor-class-agnostic; " +
      "Lexical bindings belong in apps/* or a future bindings sub-path.",
  },
  {
    group: ["prosemirror-*", "prosemirror-*/**"],
    message:
      "Editor-framework import: see docs/design/collaboration-layers.md. " +
      "Core collaboration packages must be editor-class-agnostic; " +
      "ProseMirror bindings belong in apps/* or a future bindings sub-path.",
  },
  {
    group: ["slate", "slate/**", "slate-*", "slate-*/**"],
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
 * Concatenate one or more `no-restricted-imports` pattern arrays into
 * a single array. Useful because flat-config rule reconfiguration
 * *replaces* rather than concats, so a more specific config block
 * that wants to layer additional patterns on top of
 * `egWalkerCollaborationPatterns` has to spread both sets manually.
 *
 * @example
 *   // Apply both the cross-package layering rules and a package-internal
 *   // boundary in the same `no-restricted-imports` config block:
 *   {
 *     files: ["src/core/**\/*.ts"],
 *     rules: {
 *       "no-restricted-imports": [
 *         "error",
 *         {
 *           patterns: combinePatterns(
 *             egWalkerCollaborationPatterns,
 *             ENGINE_INTERNALS_PATTERNS,
 *           ),
 *         },
 *       ],
 *     },
 *   }
 *
 * @param {...Array<object>} patternSets
 * @returns {Array<object>}
 */
export const combinePatterns = (...patternSets) => patternSets.flat();

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
