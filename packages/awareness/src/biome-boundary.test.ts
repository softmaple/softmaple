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
// PATH inside the test runtime. The bin entry is a Node JS shim that
// dispatches to the platform-specific native binary, so invoking it
// with process.execPath works everywhere @biomejs/biome installs.
const require = createRequire(import.meta.url);
const BIOME_BIN = join(
  dirname(require.resolve("@biomejs/biome/package.json")),
  "bin",
  "biome",
);

/**
 * Parse the package's `biome.jsonc` into a plain object. JSONC is a
 * strict subset of JS object-literal syntax (quoted keys, `//` and
 * `/* *\/` comments, trailing commas), so wrapping the file contents
 * in `return (...)` and handing it to `Function` is a one-line
 * alternative to pulling in a JSONC parser. Safe here because the
 * input is our own checked-in config — no untrusted content path.
 */
function parseJsonc<T>(source: string): T {
  return new Function(`return (${source});`)() as T;
}

let workDir: string;

beforeAll(() => {
  workDir = mkdtempSync(join(tmpdir(), "awareness-biome-boundary-"));
  mkdirSync(join(workDir, "src"));
  const realConfig = parseJsonc<{ files?: unknown }>(
    readFileSync(REAL_BIOME_JSONC, "utf8"),
  );
  realConfig.files = { includes: ["**/*.ts"] };
  writeFileSync(
    join(workDir, "biome.json"),
    JSON.stringify(realConfig, null, 2),
  );
});

afterAll(() => {
  if (workDir) {
    rmSync(workDir, { recursive: true, force: true });
  }
});

function lintImport(specifier: string): { exitCode: number; output: string } {
  const fixture = join(workDir, "src", "fixture.ts");
  writeFileSync(fixture, `import "${specifier}";\n`);
  try {
    const stdout = execFileSync(
      process.execPath,
      [BIOME_BIN, "lint", "--reporter=json", fixture],
      {
        cwd: PACKAGE_ROOT,
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
