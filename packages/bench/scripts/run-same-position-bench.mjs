/**
 * Same-position cold replay. Each sample starts a fresh process per
 * implementation: `--events` concurrent inserts at one position, in each of
 * the `--shapes`, are encoded as EGW4 and decoded outside the timer, then a
 * replica replays the decoded graph. Reports the replay time, the time per
 * event, how the time per event grows with the event count, and the
 * integration counters, alternating implementation order between runs. Every
 * implementation must produce the same text for a given shape and count.
 *
 * usage: node scripts/run-same-position-bench.mjs
 *   [--impl name=path/to/eg-walker/dist/index.js]...
 *   [--events 1000,10000,100000] [--shapes root,after,before]
 *   [--warmup-events 1000] [--runs 3] [--output DIR]
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

const SHAPES = ["root", "after", "before"];

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const { values } = parseArgs({
  options: {
    impl: { type: "string", multiple: true },
    events: { type: "string", default: "1000,10000,100000" },
    shapes: { type: "string", default: SHAPES.join(",") },
    "warmup-events": { type: "string", default: "1000" },
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
const eventCounts = values.events
  .split(",")
  .map((value) => positiveInteger(value.trim(), "--events"));
const shapes = values.shapes.split(",").map((value) => {
  const shape = value.trim();
  if (!SHAPES.includes(shape)) {
    throw new Error(`--shapes expects ${SHAPES.join(", ")}, got ${shape}`);
  }
  return shape;
});
const warmupEvents = nonNegativeInteger(
  values["warmup-events"],
  "--warmup-events",
);
const runs = positiveInteger(values.runs, "--runs");
const timeout = Number(values["timeout-minutes"]) * 60_000;
const output = resolve(
  values.output ?? (await mkdtemp(join(tmpdir(), "same-position-"))),
);
mkdirSync(output, { recursive: true });

const bundleDirectory = await mkdtemp(join(tmpdir(), "same-position-bundle-"));
try {
  await build({
    clean: true,
    dts: false,
    entry: {
      "same-position-worker": join(
        packageRoot,
        "src/bench/same-position-worker.ts",
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
  const digests = new Map();
  for (const events of eventCounts) {
    for (const shape of shapes) {
      for (let run = 1; run <= runs; run++) {
        const order =
          run % 2 === 1 ? implementations : [...implementations].reverse();
        for (const implementation of order) {
          const name = `events=${events} shape=${shape} ${implementation.name} run=${run}`;
          console.error(`START ${name}`);
          const child = spawnSync(
            process.execPath,
            [
              join(bundleDirectory, "same-position-worker.mjs"),
              implementation.path,
              String(events),
              shape,
              String(warmupEvents),
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
          const key = `${shape}:${events}`;
          const digest = digests.get(key);
          if (digest === undefined) {
            digests.set(key, { textDigest: result.textDigest, source: name });
          } else if (digest.textDigest !== result.textDigest) {
            throw new Error(
              `${name} produced text ${result.textDigest}, but ${digest.source} produced ${digest.textDigest}`,
            );
          }
          results.push(result);
          appendFileSync(runsPath, `${JSON.stringify(result)}\n`);
          console.error(
            `END ${name} total=${result.totalMs.toFixed(1)} ms per-event=${result.perEventUs.toFixed(2)} µs probes=${result.integrationProbes} rebuilds=${result.fugueRebuilds}`,
          );
        }
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
  const smallest = Math.min(...eventCounts);
  const medianFor = (name, shape, events, read) =>
    medianOf(
      results
        .filter(
          (result) =>
            result.implementation === name &&
            result.shape === shape &&
            result.events === events,
        )
        .map(read),
    );
  const metrics = [
    {
      title: "Cold replay",
      read: (result) => result.totalMs,
      format: (value) => `${value.toFixed(1)} ms`,
    },
    {
      title: "Per event",
      read: (result) => result.perEventUs,
      format: (value) => `${value.toFixed(2)} µs`,
    },
    {
      title: "Scan probes",
      read: (result) => result.integrationProbes,
      format: (value) => String(value),
    },
    {
      title: "Index builds",
      read: (result) => result.fugueRebuilds,
      format: (value) => String(value),
    },
  ];
  const header = `| Events | Shape | Metric |${names.map((name) => ` ${name} (median, n=${runs}) |`).join("")}${names.length === 2 ? " Change |" : ""}`;
  const divider = `|---:|---|---|${names.map(() => "---:|").join("")}${names.length === 2 ? "---:|" : ""}`;
  const rows = eventCounts.flatMap((events) =>
    shapes.flatMap((shape) => {
      const metricRows = metrics.map((metric) => {
        const medians = names.map((name) =>
          medianFor(name, shape, events, metric.read),
        );
        return formatRow(events, shape, metric.title, medians, metric.format);
      });
      // How much a replayed insert costs at this count relative to the
      // smallest one; O(n log n) replay grows it only logarithmically.
      const scaling = names.map(
        (name) =>
          medianFor(name, shape, events, (result) => result.perEventUs) /
          medianFor(name, shape, smallest, (result) => result.perEventUs),
      );
      return [
        ...metricRows,
        formatRow(
          events,
          shape,
          `Per event ÷ per event at ${smallest}`,
          scaling,
          (value) => `${value.toFixed(2)}×`,
        ),
      ];
    }),
  );
  return [header, divider, ...rows].join("\n");
}

function formatRow(events, shape, title, medians, format) {
  const change =
    medians.length !== 2
      ? ""
      : medians[0] === 0
        ? " — |"
        : ` ${(((medians[1] - medians[0]) / Math.abs(medians[0])) * 100).toFixed(1)}% |`;
  return `| ${events} | ${shape} | ${title} |${medians.map((value) => ` ${format(value)} |`).join("")}${change}`;
}

function medianOf(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = sorted.length >> 1;
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}
