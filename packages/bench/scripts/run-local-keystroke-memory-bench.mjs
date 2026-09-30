/**
 * Retained memory per local keystroke. Each sample types `--count`
 * single-character inserts into a fresh replica in a fresh `--expose-gc`
 * process and reports the JS heap and array buffers the replica retains
 * after full collections, alternating implementation order between runs.
 *
 * usage: node scripts/run-local-keystroke-memory-bench.mjs
 *   [--impl name=path/to/eg-walker/dist/index.js]...
 *   [--count 100000] [--modes append,middle] [--runs 3] [--output DIR]
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
    count: { type: "string", default: "100000" },
    modes: { type: "string", default: "append,middle" },
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
const count = positiveInteger(values.count, "--count");
const runs = positiveInteger(values.runs, "--runs");
const modes = values.modes.split(",").map((value) => value.trim());
const timeout = Number(values["timeout-minutes"]) * 60_000;
const output = resolve(
  values.output ?? (await mkdtemp(join(tmpdir(), "local-keystroke-memory-"))),
);
mkdirSync(output, { recursive: true });

const bundleDirectory = await mkdtemp(
  join(tmpdir(), "local-keystroke-memory-bundle-"),
);
try {
  await build({
    clean: true,
    dts: false,
    entry: {
      "local-keystroke-memory-worker": join(
        packageRoot,
        "src/bench/local-keystroke-memory-worker.ts",
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
  for (const mode of modes) {
    for (let run = 1; run <= runs; run++) {
      const order =
        run % 2 === 1 ? implementations : [...implementations].reverse();
      for (const implementation of order) {
        const name = `${mode} ${implementation.name} run=${run}`;
        console.error(`START ${name}`);
        const child = spawnSync(
          process.execPath,
          [
            "--expose-gc",
            join(bundleDirectory, "local-keystroke-memory-worker.mjs"),
            implementation.path,
            String(count),
            mode,
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
          `END ${name} retained=${result.retainedBytesPerKeystroke.toFixed(1)} B/keystroke`,
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

function formatTable(results) {
  const lanes = [
    {
      title: "Retained bytes / keystroke",
      read: (result) => result.retainedBytesPerKeystroke,
      format: formatBytesPerKeystroke,
    },
    {
      title: "JS heap bytes / keystroke",
      read: (result) => result.heapBytesPerKeystroke,
      format: formatBytesPerKeystroke,
    },
    {
      title: "Array buffer bytes / keystroke",
      read: (result) => result.arrayBufferBytesPerKeystroke,
      format: formatBytesPerKeystroke,
    },
    {
      title: "Typing time / keystroke",
      read: (result) => (result.typeMs * 1000) / result.count,
      format: (value) => `${value.toFixed(2)} µs`,
    },
  ];
  const header = `| Mode (${count} keystrokes) | Metric |${names.map((name) => ` ${name} (median, n=${runs}) |`).join("")}${names.length === 2 ? " Change |" : ""}`;
  const divider = `|---|---|${names.map(() => "---:|").join("")}${names.length === 2 ? "---:|" : ""}`;
  const rows = modes.flatMap((mode) =>
    lanes.map((lane) => {
      const medians = names.map((name) =>
        medianOf(
          results
            .filter(
              (result) =>
                result.implementation === name && result.mode === mode,
            )
            .map(lane.read),
        ),
      );
      const change =
        medians.length !== 2
          ? ""
          : medians[0] === 0
            ? " — |"
            : ` ${(((medians[1] - medians[0]) / medians[0]) * 100).toFixed(1)}% |`;
      return `| ${mode} | ${lane.title} |${medians.map((value) => ` ${lane.format(value)} |`).join("")}${change}`;
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

function formatBytesPerKeystroke(value) {
  if (value === undefined || Number.isNaN(value)) return "n/a";
  return `${value.toFixed(1)} B`;
}
