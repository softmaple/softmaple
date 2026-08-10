/**
 * Collaboration architecture layering rules.
 *
 * Enforces the boundaries documented in
 * `docs/design/collaboration-layers.md`:
 *
 * - `@softmaple/eg-walker` MUST NOT import higher collaboration layers,
 *   `@softmaple/awareness`, or any editor framework.
 * - `@softmaple/block-model` may import `@softmaple/eg-walker`, but MUST NOT
 *   import awareness, surface bindings, or editor frameworks.
 * - `@softmaple/binding-lexical` may import the block model and Lexical, but
 *   MUST NOT bypass the block model to import EG-walker directly.
 * - `@softmaple/collab-protocol` may import the block model, but MUST NOT
 *   depend on a binding, awareness, editor framework, or host runtime.
 * - `@softmaple/collab-runtime` may import protocol/model value contracts, but
 *   MUST NOT depend on convergence internals, UI, or a concrete host runtime.
 * - `@softmaple/awareness` MUST NOT import a document model, surface binding,
 *   or editor framework. Awareness enforces this via Biome's
 *   `style/noRestrictedImports` in `packages/awareness/biome.jsonc`.
 * - `apps/*` composes model bindings with awareness, transport, persistence,
 *   identity, and UI.
 *
 * @module @softmaple/eslint-config/collaboration-layers
 */

const AWARENESS_PATTERNS = [
  {
    group: ["@softmaple/awareness", "@softmaple/awareness/*"],
    message:
      "Cross-layer import: see docs/design/collaboration-layers.md. " +
      "Convergent document model packages must not depend on " +
      "@softmaple/awareness.",
  },
];

const EG_WALKER_PATTERNS = [
  {
    group: ["@softmaple/eg-walker", "@softmaple/eg-walker/*"],
    message:
      "Cross-layer import: see docs/design/collaboration-layers.md. " +
      "A block-model binding must use @softmaple/block-model instead of " +
      "depending on @softmaple/eg-walker directly.",
  },
];

const BLOCK_MODEL_PATTERNS = [
  {
    group: ["@softmaple/block-model", "@softmaple/block-model/*"],
    message:
      "Reverse-layer import: see docs/design/collaboration-layers.md. " +
      "@softmaple/eg-walker must not depend on @softmaple/block-model.",
  },
];

const SURFACE_BINDING_PATTERNS = [
  {
    group: ["@softmaple/binding-*", "@softmaple/binding-*/**"],
    message:
      "Reverse-layer import: see docs/design/collaboration-layers.md. " +
      "Document model packages must not depend on surface bindings.",
  },
];

const COLLAB_PROTOCOL_PATTERNS = [
  {
    group: ["@softmaple/collab-protocol", "@softmaple/collab-protocol/*"],
    message:
      "Cross-layer import: see docs/design/collaboration-layers.md. " +
      "Model, awareness, and binding packages must not depend on the " +
      "application wire protocol.",
  },
];

const COLLAB_RUNTIME_PATTERNS = [
  {
    group: ["@softmaple/collab-runtime", "@softmaple/collab-runtime/**"],
    message:
      "Reverse-layer import: see docs/design/collaboration-layers.md. " +
      "Model, awareness, binding, and wire-protocol packages must not " +
      "depend on host-level room semantics.",
  },
];

const HOST_RUNTIME_PATTERNS = [
  {
    group: [
      "@softmaple/db",
      "@softmaple/db/*",
      "@softmaple/editor",
      "@softmaple/editor/*",
      "@softmaple/ui",
      "@softmaple/ui/*",
      "@cloudflare/*",
      "@cloudflare/*/**",
      "@prisma/*",
      "@prisma/*/**",
      "@supabase/*",
      "@supabase/*/**",
      "cloudflare:*",
      "h3",
      "h3/**",
      "ioredis",
      "ioredis/**",
      "next",
      "next/**",
      "nitro",
      "nitro/**",
      "prisma",
      "prisma/**",
      "react",
      "react/**",
    ],
    message:
      "Host-runtime import: see docs/design/collaboration-layers.md. " +
      "Shared collaboration contracts contain no database, auth SDK, " +
      "server framework, deployment-runtime, or UI integrations; those " +
      "belong in apps/* adapters.",
  },
];

const COLLAB_RUNTIME_IMPORT_ALLOWLIST = [
  {
    regex:
      "^(?!(?:\\.{1,2}/|@softmaple/(?:block-model|collab-protocol)(?:/|$))).+",
    message:
      "Runtime boundary: see docs/design/collaboration-layers.md. " +
      "@softmaple/collab-runtime may import only local modules, " +
      "@softmaple/collab-protocol, and @softmaple/block-model.",
  },
];

/**
 * Editor frameworks that document model packages MUST NOT depend on.
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
      "Document model and awareness packages must be surface-agnostic; " +
      "Lexical integration belongs in @softmaple/binding-lexical.",
  },
  {
    group: ["prosemirror-*", "prosemirror-*/**"],
    message:
      "Editor-framework import: see docs/design/collaboration-layers.md. " +
      "Document model and awareness packages must be surface-agnostic; " +
      "ProseMirror integration belongs in a binding package or app staging.",
  },
  {
    group: ["slate", "slate/**", "slate-*", "slate-*/**"],
    message:
      "Editor-framework import: see docs/design/collaboration-layers.md. " +
      "Document model and awareness packages must be surface-agnostic; " +
      "Slate integration belongs in a binding package or app staging.",
  },
];

/**
 * `no-restricted-imports` patterns for `@softmaple/eg-walker`:
 * forbids awareness, reverse model/binding imports, and editor frameworks.
 */
export const egWalkerCollaborationPatterns = [
  ...AWARENESS_PATTERNS,
  ...BLOCK_MODEL_PATTERNS,
  ...SURFACE_BINDING_PATTERNS,
  ...COLLAB_PROTOCOL_PATTERNS,
  ...COLLAB_RUNTIME_PATTERNS,
  ...EDITOR_FRAMEWORK_PATTERNS,
];

/**
 * Patterns for `@softmaple/block-model`. The package is a document model
 * layer over EG-walker, so EG-walker imports are intentionally allowed.
 */
export const blockModelCollaborationPatterns = [
  ...AWARENESS_PATTERNS,
  ...SURFACE_BINDING_PATTERNS,
  ...COLLAB_PROTOCOL_PATTERNS,
  ...COLLAB_RUNTIME_PATTERNS,
  ...EDITOR_FRAMEWORK_PATTERNS,
];

/**
 * Patterns for a block-model surface binding such as binding-lexical.
 * Surface frameworks are allowed here; importing EG-walker directly is not.
 */
export const blockModelBindingCollaborationPatterns = [
  ...AWARENESS_PATTERNS,
  ...EG_WALKER_PATTERNS,
  ...COLLAB_PROTOCOL_PATTERNS,
  ...COLLAB_RUNTIME_PATTERNS,
];

/**
 * Patterns for the shared collaboration wire protocol. It serializes
 * block-model batches, while concrete transports and auth remain app-owned.
 */
export const collabProtocolCollaborationPatterns = [
  ...AWARENESS_PATTERNS,
  ...EG_WALKER_PATTERNS,
  ...SURFACE_BINDING_PATTERNS,
  ...COLLAB_RUNTIME_PATTERNS,
  ...EDITOR_FRAMEWORK_PATTERNS,
  ...HOST_RUNTIME_PATTERNS,
];

/**
 * Patterns for host-level collaboration room/session contracts. The wire
 * protocol is intentionally allowed; concrete persistence, transport,
 * deployment, editor, and UI runtimes are not.
 */
export const collabRuntimeCollaborationPatterns = [
  ...COLLAB_RUNTIME_IMPORT_ALLOWLIST,
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
