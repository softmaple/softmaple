import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Linter } from "eslint";
import typescriptParser from "@typescript-eslint/parser";

import {
  blockModelBindingCollaborationPatterns,
  blockModelCollaborationPatterns,
  collabProtocolCollaborationPatterns,
  collabRuntimeCollaborationPatterns,
  egWalkerCollaborationConfig,
  egWalkerCollaborationPatterns,
} from "../collaboration-layers.js";

/**
 * Lint a snippet against a raw `no-restricted-imports` pattern set,
 * bypassing any `files` matching. This is the most direct unit test of
 * the patterns themselves.
 *
 * @param {Array<object>} patterns
 * @param {string} code
 * @param {string} [filename]
 * @returns {ReturnType<Linter["verify"]>}
 */
function lintWithPatterns(patterns, code, filename = "fixture.ts") {
  const linter = new Linter();
  return linter.verify(
    code,
    [
      {
        files: ["**/*.ts", "**/*.tsx"],
        languageOptions: { parser: typescriptParser },
        rules: {
          "no-restricted-imports": ["error", { patterns }],
        },
      },
    ],
    { filename },
  );
}

/**
 * Lint a snippet against the full exported flat config (with `files`
 * matching). Uses a filename relative to CWD so the `files` glob applies.
 *
 * @param {Array<object>} flatConfig
 * @param {string} code
 * @param {string} relativeFilename
 * @returns {ReturnType<Linter["verify"]>}
 */
function lintWithConfig(flatConfig, code, relativeFilename) {
  const linter = new Linter();
  return linter.verify(code, flatConfig, { filename: relativeFilename });
}

function findRestrictedImportMessages(messages) {
  return messages.filter((m) => m.ruleId === "no-restricted-imports");
}

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

function typescriptFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return typescriptFiles(path);
    return [".ts", ".tsx"].includes(extname(entry.name)) ? [path] : [];
  });
}

function assertSourceTreeConforms(relativeDirectory, patterns) {
  const directory = resolve(REPO_ROOT, relativeDirectory);
  for (const filename of typescriptFiles(directory)) {
    const messages = lintWithPatterns(
      patterns,
      readFileSync(filename, "utf8"),
      filename,
    );
    const fatal = messages.filter((message) => message.fatal);
    assert.equal(
      fatal.length,
      0,
      `${relative(REPO_ROOT, filename)} could not be parsed:\n${fatal
        .map((message) => message.message)
        .join("\n")}`,
    );
    const restricted = findRestrictedImportMessages(messages);
    assert.equal(
      restricted.length,
      0,
      `${relative(REPO_ROOT, filename)} violates collaboration layering:\n${restricted
        .map((message) => message.message)
        .join("\n")}`,
    );
  }
}

test("eg-walker patterns forbid importing @softmaple/awareness", () => {
  const messages = lintWithPatterns(
    egWalkerCollaborationPatterns,
    'import { PresenceBar } from "@softmaple/awareness";\n',
  );
  const restricted = findRestrictedImportMessages(messages);
  assert.equal(
    restricted.length,
    1,
    "expected exactly one restricted-import error",
  );
  assert.match(restricted[0].message, /@softmaple\/awareness/);
});

test("eg-walker patterns forbid importing @softmaple/awareness subpaths", () => {
  const messages = lintWithPatterns(
    egWalkerCollaborationPatterns,
    'import { LiveCursor } from "@softmaple/awareness/components/live-cursor";\n',
  );
  assert.equal(findRestrictedImportMessages(messages).length, 1);
});

test("eg-walker patterns forbid reverse imports from block models and bindings", () => {
  for (const specifier of [
    "@softmaple/block-model",
    "@softmaple/block-model/testing",
    "@softmaple/binding-lexical",
    "@softmaple/binding-lexical/react",
    "@softmaple/collab-protocol",
    "@softmaple/collab-runtime",
    "@softmaple/collab-runtime/internal/contracts",
  ]) {
    const messages = lintWithPatterns(
      egWalkerCollaborationPatterns,
      `import x from "${specifier}";\n`,
    );
    assert.equal(
      findRestrictedImportMessages(messages).length,
      1,
      `expected ${specifier} to be restricted`,
    );
  }
});

test("eg-walker patterns forbid editor frameworks (lexical, prosemirror, slate)", () => {
  for (const specifier of [
    "lexical",
    "@lexical/react",
    "prosemirror-state",
    "slate",
    "slate-react",
  ]) {
    const messages = lintWithPatterns(
      egWalkerCollaborationPatterns,
      `import x from "${specifier}";\n`,
    );
    assert.equal(
      findRestrictedImportMessages(messages).length,
      1,
      `expected ${specifier} to be restricted`,
    );
  }
});

test("eg-walker patterns forbid editor-framework subpath imports", () => {
  // minimatch's `*` does not cross `/`, so subpath imports below the
  // top-level package are a real failure mode without `**` siblings.
  for (const specifier of [
    "lexical/LexicalEditor",
    "@lexical/react/LexicalComposer",
    "@lexical/react/LexicalComposerContext",
    "prosemirror-state/style",
    "prosemirror-view/dist/index.js",
    "slate/dist/index",
    "slate-react/dist/dom",
  ]) {
    const messages = lintWithPatterns(
      egWalkerCollaborationPatterns,
      `import x from "${specifier}";\n`,
    );
    assert.equal(
      findRestrictedImportMessages(messages).length,
      1,
      `expected ${specifier} subpath to be restricted`,
    );
  }
});

test("eg-walker patterns allow benign imports", () => {
  const messages = lintWithPatterns(
    egWalkerCollaborationPatterns,
    'import lz4 from "lz4js";\nimport type { Foo } from "./types";\n',
  );
  assert.equal(findRestrictedImportMessages(messages).length, 0);
});

test("egWalkerCollaborationConfig trips on a deliberately-bad import in a .ts file", () => {
  const messages = lintWithConfig(
    egWalkerCollaborationConfig,
    'import { PresenceBar } from "@softmaple/awareness";\n',
    "src/fixtures/replica.ts",
  );
  assert.equal(findRestrictedImportMessages(messages).length, 1);
});

test("egWalkerCollaborationConfig does not match non-TS fixtures", () => {
  const messages = lintWithConfig(
    egWalkerCollaborationConfig,
    'import { PresenceBar } from "@softmaple/awareness";\n',
    "src/fixtures/notes.md",
  );
  // No matching config for a .md file -> no restricted-imports error.
  assert.equal(findRestrictedImportMessages(messages).length, 0);
});

test("block-model patterns allow EG-walker but forbid awareness, bindings, and editors", () => {
  for (const specifier of [
    "@softmaple/awareness",
    "@softmaple/binding-lexical",
    "@softmaple/binding-lexical/react",
    "@softmaple/collab-protocol",
    "@softmaple/collab-runtime",
    "lexical",
    "@lexical/react/LexicalComposer",
  ]) {
    const messages = lintWithPatterns(
      blockModelCollaborationPatterns,
      `import x from "${specifier}";\n`,
    );
    assert.equal(
      findRestrictedImportMessages(messages).length,
      1,
      `expected ${specifier} to be restricted`,
    );
  }
  const allowed = lintWithPatterns(
    blockModelCollaborationPatterns,
    'import { EgWalkerReplica } from "@softmaple/eg-walker";\nimport { captureAnchor } from "@softmaple/eg-walker/anchors";\n',
  );
  assert.equal(findRestrictedImportMessages(allowed).length, 0);
});

test("block-model binding patterns prevent bypassing the model API", () => {
  for (const specifier of [
    "@softmaple/awareness",
    "@softmaple/awareness/components/live-cursor",
    "@softmaple/eg-walker",
    "@softmaple/eg-walker/anchors",
    "@softmaple/collab-protocol",
    "@softmaple/collab-runtime",
  ]) {
    const messages = lintWithPatterns(
      blockModelBindingCollaborationPatterns,
      `import x from "${specifier}";\n`,
    );
    assert.equal(findRestrictedImportMessages(messages).length, 1);
  }
  const allowed = lintWithPatterns(
    blockModelBindingCollaborationPatterns,
    'import { BlockReplica } from "@softmaple/block-model";\nimport { createEditor } from "lexical";\n',
  );
  assert.equal(findRestrictedImportMessages(allowed).length, 0);
});

test("collab-protocol allows block-model but forbids host and higher layers", () => {
  for (const specifier of [
    "@softmaple/awareness",
    "@softmaple/eg-walker",
    "@softmaple/binding-lexical",
    "@softmaple/collab-runtime",
    "@softmaple/db",
    "@prisma/adapter-pg",
    "@prisma/client",
    "@prisma/client/runtime/client",
    "@supabase/supabase-js",
    "nitro",
    "next/server",
    "react",
    "lexical",
  ]) {
    const messages = lintWithPatterns(
      collabProtocolCollaborationPatterns,
      `import x from "${specifier}";\n`,
    );
    assert.equal(
      findRestrictedImportMessages(messages).length,
      1,
      `expected ${specifier} to be restricted`,
    );
  }
  const allowed = lintWithPatterns(
    collabProtocolCollaborationPatterns,
    'import { parseRichTextEventBatch } from "@softmaple/block-model";\n',
  );
  assert.equal(findRestrictedImportMessages(allowed).length, 0);
});

test("collab-runtime allows protocol contracts but forbids host infrastructure", () => {
  for (const specifier of [
    "@softmaple/awareness",
    "@softmaple/awareness/protocol",
    "@softmaple/awareness/types/presence",
    "@softmaple/eg-walker",
    "@softmaple/binding-lexical",
    "@softmaple/db",
    "@softmaple/editor",
    "@softmaple/ui",
    "@cloudflare/workers-types",
    "@prisma/client",
    "@supabase/supabase-js",
    "cloudflare:workers",
    "h3",
    "ioredis",
    "next/server",
    "nitro",
    "node:crypto",
    "prisma",
    "react",
    "lexical",
    "lodash",
    "vitest",
  ]) {
    const messages = lintWithPatterns(
      collabRuntimeCollaborationPatterns,
      `import x from "${specifier}";\n`,
    );
    assert.equal(
      findRestrictedImportMessages(messages).length,
      1,
      `expected ${specifier} to be restricted`,
    );
  }
  const allowed = lintWithPatterns(
    collabRuntimeCollaborationPatterns,
    'import type { ClientCollabMessage } from "@softmaple/collab-protocol";\nimport type { RichTextEventBatch } from "@softmaple/block-model";\nimport type { Local } from "./local";\nimport type { Parent } from "../parent";\n',
  );
  assert.equal(findRestrictedImportMessages(allowed).length, 0);
});

test("collaboration package source trees obey their dependency direction", () => {
  for (const [directory, patterns] of [
    ["packages/eg-walker/src", egWalkerCollaborationPatterns],
    ["packages/block-model/src", blockModelCollaborationPatterns],
    ["packages/binding-lexical/src", blockModelBindingCollaborationPatterns],
    ["packages/collab-protocol/src", collabProtocolCollaborationPatterns],
    ["packages/collab-runtime/src", collabRuntimeCollaborationPatterns],
  ]) {
    assertSourceTreeConforms(directory, patterns);
  }
});
