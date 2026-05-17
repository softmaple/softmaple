import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(__dirname, "..");
const REAL_BIOME_JSONC = join(PACKAGE_ROOT, "biome.jsonc");

function stripJsonComments(input: string): string {
  let out = "";
  let i = 0;
  while (i < input.length) {
    const c = input[i];
    if (c === '"') {
      out += c;
      i++;
      while (i < input.length) {
        out += input[i];
        if (input[i] === "\\" && i + 1 < input.length) {
          out += input[i + 1];
          i += 2;
        } else if (input[i] === '"') {
          i++;
          break;
        } else {
          i++;
        }
      }
    } else if (c === "/" && input[i + 1] === "/") {
      while (i < input.length && input[i] !== "\n") i++;
    } else if (c === "/" && input[i + 1] === "*") {
      i += 2;
      while (
        i < input.length - 1 &&
        !(input[i] === "*" && input[i + 1] === "/")
      ) {
        i++;
      }
      i += 2;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

let workDir: string;

beforeAll(() => {
  workDir = mkdtempSync(join(tmpdir(), "awareness-biome-boundary-"));
  mkdirSync(join(workDir, "src"));
  const realConfig = JSON.parse(
    stripJsonComments(readFileSync(REAL_BIOME_JSONC, "utf8")),
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
      "pnpm",
      ["exec", "biome", "lint", "--reporter=json", fixture],
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
