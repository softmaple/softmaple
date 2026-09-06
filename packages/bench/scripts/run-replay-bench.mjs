import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "tsup";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = await mkdtemp(
  join(tmpdir(), "eg-walker-replay-bench-"),
);
const outputFile = join(outputDirectory, "replay-optimization.mjs");

try {
  await build({
    clean: true,
    dts: false,
    entry: {
      "replay-optimization": join(
        packageRoot,
        "src/bench/replay-optimization.ts",
      ),
    },
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
