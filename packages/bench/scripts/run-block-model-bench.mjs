/**
 * Bundle the block-model edit-latency worker and run it for each history size
 * in fresh processes, alternating implementation order between runs.
 *
 * usage: node scripts/run-block-model-bench.mjs [--impl name=dist/index.js]...
 *   [--batches 50,200,800,3200,10000] [--runs 3] [--samples 21]
 *   [--paragraph-length 0] [--output dir]
 */
import console from "node:console";
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { build } from "tsup";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const { values } = parseArgs({
  options: {
    impl: { type: "string", multiple: true },
    batches: { type: "string", default: "50,200,800,3200,10000" },
    runs: { type: "string", default: "3" },
    samples: { type: "string", default: "21" },
    "paragraph-length": { type: "string", default: "0" },
    output: { type: "string" },
  },
});

const implementations = (
  values.impl ?? [`head=${join(packageRoot, "../block-model/dist/index.js")}`]
).map((entry) => {
  const separator = entry.indexOf("=");
  if (separator <= 0) {
    throw new Error(`--impl expects name=path/to/dist/index.js, got ${entry}`);
  }
  return {
    name: entry.slice(0, separator),
    path: resolve(entry.slice(separator + 1)),
  };
});
const sizes = values.batches.split(",").map(Number);
const runs = Number(values.runs);
if (!Number.isSafeInteger(runs) || runs < 1) {
  throw new Error("--runs must be a positive integer");
}
const output = values.output === undefined ? null : resolve(values.output);
if (output !== null) {
  mkdirSync(output, { recursive: true });
}

const bundleDirectory = await mkdtemp(join(tmpdir(), "block-model-bench-"));
const worker = join(bundleDirectory, "block-model-edit-latency.mjs");
try {
  await build({
    clean: true,
    dts: false,
    entry: {
      "block-model-edit-latency": join(
        packageRoot,
        "src/bench/block-model-edit-latency.ts",
      ),
    },
    format: ["esm"],
    minify: false,
    noExternal: [/.*/],
    outDir: bundleDirectory,
    outExtension: () => ({ js: ".mjs" }),
    platform: "node",
    silent: true,
    sourcemap: false,
    splitting: false,
  });

  const results = [];
  for (const size of sizes) {
    for (let run = 1; run <= runs; run++) {
      const order =
        run % 2 === 1 ? implementations : [...implementations].reverse();
      for (const implementation of order) {
        const label = `${implementation.name} batches=${size} run=${run}`;
        console.error(`START ${label}`);
        const child = spawnSync(
          process.execPath,
          [
            "--expose-gc",
            worker,
            implementation.path,
            String(size),
            values.samples,
            values["paragraph-length"],
          ],
          { encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: 1_800_000 },
        );
        if (child.status !== 0) {
          throw new Error(`${label} failed:\n${child.stderr}`);
        }
        const result = {
          implementation: implementation.name,
          run,
          ...JSON.parse(child.stdout.trim().split("\n").at(-1)),
        };
        results.push(result);
        if (output !== null) {
          appendFileSync(
            join(output, "runs.jsonl"),
            `${JSON.stringify(result)}\n`,
          );
        }
        console.error(
          `END ${label} local=${result.localMedianMs.toFixed(3)}ms remote=${result.remoteMedianMs.toFixed(3)}ms replace=${result.replaceMedianMs.toFixed(3)}ms`,
        );
      }
    }
  }
  console.log(formatTable(results));
} finally {
  await rm(bundleDirectory, { force: true, recursive: true });
}

function formatTable(results) {
  const names = implementations.map(({ name }) => name);
  const header = [
    "| Batches in history | Lane |",
    ...names.map((name) => ` ${name} (median, n=${runs}) |`),
    names.length === 2 ? " Change |" : "",
  ].join("");
  const divider = `|---:|---|${names.map(() => "---:|").join("")}${names.length === 2 ? "---:|" : ""}`;
  const rows = [];
  for (const size of sizes) {
    for (const [lane, key] of [
      ["Local `transact(insertText)`", "localMedianMs"],
      ["Remote `applyRemoteEvents`", "remoteMedianMs"],
      ["Local `transact(replaceDocument)`", "replaceMedianMs"],
    ]) {
      const medians = names.map((name) =>
        medianOf(
          results
            .filter(
              (result) =>
                result.implementation === name && result.batches === size,
            )
            .map((result) => result[key]),
        ),
      );
      const change =
        medians.length === 2
          ? ` ${(((medians[1] - medians[0]) / medians[0]) * 100).toFixed(1)}% |`
          : "";
      rows.push(
        `| ${size.toLocaleString("en-US")} | ${lane} |${medians
          .map((value) => ` ${formatMs(value)} |`)
          .join("")}${change}`,
      );
    }
  }
  return [header, divider, ...rows].join("\n");
}

function medianOf(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = sorted.length >> 1;
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function formatMs(value) {
  return value >= 10 ? `${value.toFixed(1)} ms` : `${value.toFixed(3)} ms`;
}
