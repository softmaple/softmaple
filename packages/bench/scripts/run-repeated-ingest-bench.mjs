/**
 * Repeated whole-trace ingest in one process. Each sample builds causal
 * batches for the whole trace and applies them to a fresh replica
 * `--iterations` times, recording batch-build ms, apply ms and GC pause time
 * per iteration. Every sample runs in a fresh process, alternating
 * implementation order between runs.
 *
 * usage: node scripts/run-repeated-ingest-bench.mjs
 *   [--impl name=path/to/eg-walker/dist/index.js]...
 *   [--datasets S3] [--iterations 3] [--apply-batch-events all]
 *   [--retain-replicas] [--runs 3] [--paper-root PATH] [--output DIR]
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
    datasets: { type: "string", default: "S3" },
    iterations: { type: "string", default: "3" },
    "apply-batch-events": { type: "string", default: "all" },
    "retain-replicas": { type: "boolean", default: false },
    runs: { type: "string", default: "3" },
    "paper-root": {
      type: "string",
      default: resolve(packageRoot, "../../..", "egwalker-paper"),
    },
    output: { type: "string" },
    "timeout-minutes": { type: "string", default: "30" },
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
const datasets = values.datasets.split(",").map((value) => value.trim());
const iterations = positiveInteger(values.iterations, "--iterations");
const runs = positiveInteger(values.runs, "--runs");
const timeout = Number(values["timeout-minutes"]) * 60_000;
const output = resolve(
  values.output ?? (await mkdtemp(join(tmpdir(), "repeated-ingest-"))),
);
mkdirSync(output, { recursive: true });

const bundleDirectory = await mkdtemp(join(tmpdir(), "repeated-ingest-bundle-"));
try {
  await build({
    clean: true,
    dts: false,
    entry: {
      "repeated-ingest-worker": join(
        packageRoot,
        "src/bench/repeated-ingest-worker.ts",
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
  for (const dataset of datasets) {
    for (let run = 1; run <= runs; run++) {
      const order =
        run % 2 === 1 ? implementations : [...implementations].reverse();
      for (const implementation of order) {
        const name = `${dataset} ${implementation.name} run=${run}`;
        console.error(`START ${name}`);
        const child = spawnSync(
          process.execPath,
          [
            "--max-old-space-size=6656",
            join(bundleDirectory, "repeated-ingest-worker.mjs"),
            implementation.path,
            values["paper-root"],
            dataset,
            String(iterations),
            values["apply-batch-events"],
            ...(values["retain-replicas"] ? ["--retain-replicas"] : []),
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
        appendFileSync(
          join(output, "runs.jsonl"),
          `${JSON.stringify(result)}\n`,
        );
        const perIteration = result.iterations
          .map(
            (entry) =>
              `#${entry.iteration} build=${entry.buildMs.toFixed(0)} apply=${entry.applyMs.toFixed(0)} gc=${entry.gc.gcMs.toFixed(0)}`,
          )
          .join(" ");
        console.error(`END ${name} ${perIteration}`);
      }
    }
  }

  const table = formatTable(results);
  writeFileSync(join(output, "summary.md"), `${table}\n`);
  console.log(table);
  console.error(`raw samples: ${join(output, "runs.jsonl")}`);
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

function formatTable(results) {
  const iterationNumbers = Array.from(
    { length: iterations },
    (_, index) => index + 1,
  );
  const perIteration = (title, read, format = formatMs) =>
    iterationNumbers.map((iteration) => ({
      title: `${title}, iteration ${iteration}`,
      read: (result) => read(result.iterations[iteration - 1]),
      format,
    }));
  const againstFirst = (title, read) =>
    iterationNumbers.slice(1).map((iteration) => ({
      title: `${title}, iteration ${iteration} ÷ iteration 1`,
      read: (result) =>
        read(result.iterations[iteration - 1]) / read(result.iterations[0]),
      format: formatRatio,
      ratio: true,
    }));
  // A full collection of earlier iterations' garbage can land in any phase,
  // so apply is also reported without the GC pauses that started in it.
  const applyWithoutGc = (entry) => entry.applyMs - entry.applyGcMs;
  const lanes = [
    ...perIteration("Batch build", (entry) => entry.buildMs),
    ...perIteration("Apply", (entry) => entry.applyMs),
    ...perIteration("Apply without GC pauses", applyWithoutGc),
    ...perIteration("GC pause", (entry) => entry.gc.gcMs),
    ...againstFirst("Batch build", (entry) => entry.buildMs),
    ...againstFirst("Apply", (entry) => entry.applyMs),
    ...againstFirst("Apply without GC pauses", applyWithoutGc),
    {
      title: "Peak RSS",
      read: (result) => result.maxRssKiB * 1024,
      format: formatBytes,
    },
  ];
  const header = `| Dataset | Metric |${names.map((name) => ` ${name} (median, n=${runs}) |`).join("")}${names.length === 2 ? " Change |" : ""}`;
  const divider = `|---|---|${names.map(() => "---:|").join("")}${names.length === 2 ? "---:|" : ""}`;
  const rows = datasets.flatMap((dataset) =>
    lanes.map((lane) => {
      const medians = names.map((name) =>
        medianOf(
          results
            .filter(
              (result) =>
                result.implementation === name && result.dataset === dataset,
            )
            .map(lane.read),
        ),
      );
      const change =
        medians.length !== 2
          ? ""
          : lane.ratio
            ? " — |"
            : ` ${(((medians[1] - medians[0]) / medians[0]) * 100).toFixed(1)}% |`;
      return `| ${dataset} | ${lane.title} |${medians.map((value) => ` ${lane.format(value)} |`).join("")}${change}`;
    }),
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

function formatMs(value) {
  if (value === undefined || Number.isNaN(value)) return "n/a";
  if (value >= 1000) return `${(value / 1000).toFixed(2)} s`;
  return value >= 10 ? `${value.toFixed(1)} ms` : `${value.toFixed(3)} ms`;
}

function formatRatio(value) {
  if (value === undefined || Number.isNaN(value)) return "n/a";
  return `${value.toFixed(2)}×`;
}

function formatBytes(value) {
  if (value === undefined || Number.isNaN(value)) return "n/a";
  return `${(value / (1024 * 1024)).toFixed(1)} MiB`;
}
