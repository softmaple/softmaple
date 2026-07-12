import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "tsup";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const defaultPaperRoot = resolve(packageRoot, "../../..", "egwalker-paper");
process.argv.splice(2, 0, "--paper-root", defaultPaperRoot);
const outputDirectory = await mkdtemp(join(tmpdir(), "eg-walker-paper-bench-"));
const outputFile = join(outputDirectory, "paper-bench.mjs");

try {
  await build({
    clean: true,
    dts: false,
    entry: { "paper-bench": join(packageRoot, "src/bench/paper-bench.ts") },
    format: ["esm"],
    minify: false,
    noExternal: [/.*/],
    outDir: outputDirectory,
    outExtension: () => ({ js: ".mjs" }),
    platform: "node",
    silent: true,
    sourcemap: false,
    splitting: false,
  });
  await import(pathToFileURL(outputFile).href);
} finally {
  await rm(outputDirectory, { force: true, recursive: true });
}
