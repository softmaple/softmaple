import { test } from "node:test";
import assert from "node:assert/strict";

import { Linter } from "eslint";

import {
  EDITOR_FRAMEWORK_PATTERNS,
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
 * @returns {ReturnType<Linter["verify"]>}
 */
function lintWithPatterns(patterns, code) {
  const linter = new Linter({ configType: "flat" });
  return linter.verify(code, [
    {
      rules: {
        "no-restricted-imports": ["error", { patterns }],
      },
    },
  ]);
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
  const linter = new Linter({ configType: "flat" });
  return linter.verify(code, flatConfig, { filename: relativeFilename });
}

function findRestrictedImportMessages(messages) {
  return messages.filter((m) => m.ruleId === "no-restricted-imports");
}

test("eg-walker patterns forbid importing @softmaple/awareness", () => {
  const messages = lintWithPatterns(
    egWalkerCollaborationPatterns,
    'import { PresenceBar } from "@softmaple/awareness";\n',
  );
  const restricted = findRestrictedImportMessages(messages);
  assert.equal(restricted.length, 1, "expected exactly one restricted-import error");
  assert.match(restricted[0].message, /@softmaple\/awareness/);
});

test("eg-walker patterns forbid importing @softmaple/awareness subpaths", () => {
  const messages = lintWithPatterns(
    egWalkerCollaborationPatterns,
    'import { LiveCursor } from "@softmaple/awareness/components/live-cursor";\n',
  );
  assert.equal(findRestrictedImportMessages(messages).length, 1);
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

test("EDITOR_FRAMEWORK_PATTERNS is included in eg-walker patterns", () => {
  for (const editorPattern of EDITOR_FRAMEWORK_PATTERNS) {
    assert.ok(
      egWalkerCollaborationPatterns.includes(editorPattern),
      "eg-walker patterns should include shared editor patterns",
    );
  }
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
