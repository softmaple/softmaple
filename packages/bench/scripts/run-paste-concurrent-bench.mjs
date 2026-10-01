/**
 * Concurrent paste merge. Each sample starts a fresh `--expose-gc` process
 * per implementation: two replicas share a typed document, one pastes
 * `--sizes` characters while the other types one character, and each merges
 * the other's event. Reports merge time, the replay engine's live and peak
 * sequence records and the heap each merge retains after full collections,
 * alternating implementation order between runs.
 *
 * usage: node scripts/run-paste-concurrent-bench.mjs
 *   [--impl name=path/to/eg-walker/dist/index.js]...
 *   [--sizes 10000,100000] [--base-length 1000] [--warmup 1] [--runs 3]
 *   [--output DIR]
 */
import console from "node:console";
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
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
    sizes: { type: "string", default: "10000,100000" },
    "base-length": { type: "string", default: "1000" },
    warmup: { type: "string", default: "1" },
    runs: { type: "string", default: "3" },
    output: { type: "string" },
    "timeout-minutes": { type: "string", default: "10" },
  },
});

const implementations = (
  values.impl ?? [`head=${join(packageRoot, "../eg-walker/dist/index.js")}`]
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
const names = implementations.map(({ name }) => name);
if (new Set(names).size !== names.length) {
  throw new Error("--impl names must be unique");
}
const sizes = values.sizes
  .split(",")
  .map((value) => positiveInteger(value.trim(), "--sizes"));
const baseLength = positiveInteger(values["base-length"], "--base-length");
const warmup = nonNegativeInteger(values.warmup, "--warmup");
const runs = positiveInteger(values.runs, "--runs");
const timeout = Number(values["timeout-minutes"]) * 60_000;
const output = resolve(
  values.output ?? (await mkdtemp(join(tmpdir(), "paste-concurrent-"))),
);
mkdirSync(output, { recursive: true });

const bundleDirectory = await mkdtemp(
  join(tmpdir(), "paste-concurrent-bundle-"),
);
try {
  await build({
    clean: true,
    dts: false,
    entry: {
      "paste-concurrent-worker": join(
        packageRoot,
        "src/bench/paste-concurrent-worker.ts",
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

  const runsPath = join(output, "runs.jsonl");
  writeFileSync(runsPath, "");
  const results = [];
  for (const size of sizes) {
    for (let run = 1; run <= runs; run++) {
      const order =
        run % 2 === 1 ? implementations : [...implementations].reverse();
      for (const implementation of order) {
        const name = `paste=${size} ${implementation.name} run=${run}`;
        console.error(`START ${name}`);
        const child = spawnSync(
          process.execPath,
          [
            "--expose-gc",
            join(bundleDirectory, "paste-concurrent-worker.mjs"),
            implementation.path,
            String(size),
            String(baseLength),
            String(warmup),
          ],
          { encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout },
        );
        if (child.status !== 0) {
          throw new Error(
            `${name} failed (${child.signal ?? child.status}):\n${child.stderr}`,
          );
        }
        const result = {
          implementation: implementation.name,
          run,
          ...JSON.parse(child.stdout.trim().split("\n").at(-1)),
        };
        results.push(result);
        appendFileSync(runsPath, `${JSON.stringify(result)}\n`);
        console.error(
          `END ${name} paster=${result.paster.mergeMs.toFixed(2)} ms editor=${result.editor.mergeMs.toFixed(2)} ms`,
        );
      }
    }
  }

  const table = formatTable(results);
  writeFileSync(join(output, "summary.md"), `${table}\n`);
  console.log(table);
  console.error(`raw samples: ${runsPath}`);
} finally {
  await rm(bundleDirectory, { force: true, recursive: true });
}

function positiveInteger(value, flag) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${flag} must be a positive integer, got ${value}`);
  }
  return parsed;
}

function nonNegativeInteger(value, flag) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${flag} must be a non-negative integer, got ${value}`);
  }
  return parsed;
}

function formatTable(results) {
  const sides = [
    { key: "paster", title: "paster merges the keystroke" },
    { key: "editor", title: "editor merges the paste" },
  ];
  const metrics = [
    {
      title: "Merge",
      read: (side) => side.mergeMs,
      format: (value) => `${value.toFixed(2)} ms`,
    },
    {
      title: "`sequenceRecordCount`",
      read: (side) => side.sequenceRecordCount,
      format: (value) => String(value),
    },
    {
      title: "`peakSequenceRecordCount`",
      read: (side) => side.peakSequenceRecordCount,
      format: (value) => String(value),
    },
    {
      title: "Heap delta after GC",
      read: (side) => side.heapBytes,
      format: formatMegabytes,
    },
    {
      title: "Array buffer delta after GC",
      read: (side) => side.arrayBufferBytes,
      format: formatMegabytes,
    },
  ];
  const header = `| Paste | Side | Metric |${names.map((name) => ` ${name} (median, n=${runs}) |`).join("")}${names.length === 2 ? " Change |" : ""}`;
  const divider = `|---:|---|---|${names.map(() => "---:|").join("")}${names.length === 2 ? "---:|" : ""}`;
  const rows = sizes.flatMap((size) =>
    sides.flatMap((side) =>
      metrics.map((metric) => {
        const medians = names.map((name) =>
          medianOf(
            results
              .filter(
                (result) =>
                  result.implementation === name && result.pasteLength === size,
              )
              .map((result) => metric.read(result[side.key])),
          ),
        );
        const change =
          medians.length !== 2
            ? ""
            : medians[0] === 0
              ? " — |"
              : ` ${(((medians[1] - medians[0]) / Math.abs(medians[0])) * 100).toFixed(1)}% |`;
        return `| ${size} | ${side.title} | ${metric.title} |${medians.map((value) => ` ${metric.format(value)} |`).join("")}${change}`;
      }),
    ),
  );
  return [header, divider, ...rows].join("\n");
}

function medianOf(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = sorted.length >> 1;
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function formatMegabytes(value) {
  if (value === undefined || Number.isNaN(value)) return "n/a";
  return `${(value / (1024 * 1024)).toFixed(2)} MB`;
}
