import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(__dirname, "..");
const REAL_BIOME_JSONC = join(PACKAGE_ROOT, "biome.jsonc");

// Resolve the biome CLI directly via @biomejs/biome's package.json so
// the test does not depend on `pnpm` (or any other launcher) being on
// PATH inside the test runtime. Read the bin path from the package's
// own `bin` field rather than hardcoding `bin/biome` so the test
// keeps working if @biomejs/biome ever relocates its entry point.
// The bin entry is a Node JS shim that dispatches to the
// platform-specific native binary, so invoking it with
// process.execPath works everywhere @biomejs/biome installs.
const require = createRequire(import.meta.url);
const biomePkgPath = require.resolve("@biomejs/biome/package.json");
const biomePkg = require(biomePkgPath) as { bin: { biome: string } };
const BIOME_BIN = join(dirname(biomePkgPath), biomePkg.bin.biome);

/**
 * Parse the package's own `biome.jsonc` into a plain object.
 *
 * JSONC is a strict subset of JS object-literal syntax (quoted keys,
 * `//` and `/* *\/` comments, trailing commas), so wrapping the file
 * contents in `return (...)` and handing it to `Function` is a
 * one-line alternative to pulling in a JSONC parser.
 *
 * **Intentionally lax**: this helper would also accept JS that is not
 * valid JSONC (computed expressions, identifier references, etc.).
 * That is acceptable *only* because the single caller passes our own
 * checked-in `biome.jsonc`. Do not generalise this to untrusted input
 * — use a real JSONC parser if the call site changes.
 */
function parseOwnBiomeConfig<T>(source: string): T {
  return new Function(`return (${source});`)() as T;
}

let workDir: string;

function cleanupWorkDir(): void {
  if (workDir) {
    rmSync(workDir, { recursive: true, force: true });
  }
}

// `afterAll` covers the normal path; the process-exit hook is a
// belt-and-suspenders safety net for the case where vitest crashes
// (or the worker is killed) between beforeAll and afterAll. Without
// it, the temp dir would be orphaned in os.tmpdir() on crash. Both
// callbacks are idempotent — rmSync with { force: true } on a
// missing path is a no-op.
process.on("exit", cleanupWorkDir);

beforeAll(() => {
  workDir = mkdtempSync(join(tmpdir(), "awareness-biome-boundary-"));
  mkdirSync(join(workDir, "src"));
  const realConfig = parseOwnBiomeConfig<{
    files?: unknown;
    root?: boolean;
  }>(readFileSync(REAL_BIOME_JSONC, "utf8"));
  realConfig.root = true;
  realConfig.files = { includes: ["**/*.ts"] };
  writeFileSync(
    join(workDir, "biome.json"),
    JSON.stringify(realConfig, null, 2),
  );
});

afterAll(() => {
  cleanupWorkDir();
  // Deregister the exit hook on the happy path so vitest watch-mode
  // reloads do not accumulate listeners (Node warns past 10).
  process.off("exit", cleanupWorkDir);
});

function lintImport(specifier: string): { exitCode: number; output: string } {
  // Per-call fixture name so concurrent test execution (vitest's
  // describe.concurrent, or a future default flip) cannot race two
  // cases on the same file. Sanitise the specifier into a filename-
  // safe slug; the resulting path stays inside workDir so cleanup
  // via rmSync(workDir) still catches every fixture.
  const slug = specifier.replace(/[^a-z0-9]+/gi, "_");
  const fixture = join(workDir, "src", `fixture-${slug}.ts`);
  writeFileSync(fixture, `import "${specifier}";\n`);
  try {
    // Pass the isolated config explicitly. Once the monorepo has a root
    // biome.json, relying on discovery would select that config from the
    // test runner's cwd instead of the fixture config outside the repo.
    const stdout = execFileSync(
      process.execPath,
      [
        BIOME_BIN,
        "lint",
        "--config-path",
        join(workDir, "biome.json"),
        "--reporter=json",
        fixture,
      ],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    return { exitCode: 0, output: stdout };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return {
      exitCode: typeof e.status === "number" ? e.status : 1,
      output: `${e.stdout ?? ""}${e.stderr ?? ""}`,
    };
  }
}

describe("biome collaboration-layers boundary", () => {
  it.each([
    "@softmaple/eg-walker",
    "@softmaple/eg-walker/internal",
    "@softmaple/block-model",
    "@softmaple/block-model/testing",
    "@softmaple/binding-lexical",
    "@softmaple/binding-lexical/react",
    "@softmaple/collab-protocol",
    "@softmaple/collab-protocol/internal",
    "@softmaple/collab-runtime",
    "@softmaple/collab-runtime/internal",
    "lexical",
    "lexical/LexicalEditor",
    "@lexical/react",
    "@lexical/react/LexicalComposer",
    "prosemirror-state",
    "prosemirror-view/dist/index.js",
    "slate",
    "slate-react",
    "slate-react/dist/dom",
  ])("forbids importing %s", (specifier) => {
    const { exitCode, output } = lintImport(specifier);
    expect(
      exitCode,
      `expected non-zero exit for ${specifier}; biome output:\n${output}`,
    ).not.toBe(0);
    expect(output).toMatch(/noRestrictedImports/);
  }, 20_000);

  it("allows a benign import (react)", () => {
    const { exitCode } = lintImport("react");
    expect(exitCode).toBe(0);
  }, 20_000);
});
