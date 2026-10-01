/**
 * A burst of concurrent edits from one peer after opening a paper dataset,
 * by a cold load of its decoded graph or with `fromPortableSnapshot`.
 * Prepares one EGWP1 snapshot per dataset with this checkout's eg-walker,
 * then measures every case in a fresh process per sample, alternating
 * implementation order between runs.
 *
 * usage: node scripts/run-concurrent-burst-bench.mjs
 *   [--impl name=path/to/eg-walker/dist/index.js]...
 *   [--datasets S1,C1,A1,A2] [--opens native,portable]
 *   [--depths 10,1000,10000] [--edits 6] [--runs 3]
 *   [--paper-root PATH] [--output DIR] [--reuse-fixtures]
 */
import assert from "node:assert/strict";
import console from "node:console";
import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
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
    datasets: { type: "string", default: "S1,C1,A1,A2" },
    opens: { type: "string", default: "native,portable" },
    depths: { type: "string", default: "10,1000,10000" },
    edits: { type: "string", default: "6" },
    runs: { type: "string", default: "3" },
    "paper-root": {
      type: "string",
      default: resolve(packageRoot, "../../..", "egwalker-paper"),
    },
    output: { type: "string" },
    "reuse-fixtures": { type: "boolean", default: false },
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
const opens = values.opens.split(",").map((value) => {
  const open = value.trim();
  if (open !== "native" && open !== "portable") {
    throw new Error(`--opens lists native or portable, got ${open}`);
  }
  return open;
});
const depths = values.depths
  .split(",")
  .map((value) => nonNegativeInteger(value.trim(), "--depths"));
const edits = positiveInteger(values.edits, "--edits");
const runs = positiveInteger(values.runs, "--runs");
const timeout = Number(values["timeout-minutes"]) * 60_000;
const output = resolve(
  values.output ?? (await mkdtemp(join(tmpdir(), "concurrent-burst-"))),
);
const fixtures = join(output, "fixtures");
mkdirSync(fixtures, { recursive: true });

const bundleDirectory = await mkdtemp(
  join(tmpdir(), "concurrent-burst-bundle-"),
);
try {
  await build({
    clean: true,
    dts: false,
    entry: {
      "snapshot-first-edit-prepare": join(
        packageRoot,
        "src/bench/snapshot-first-edit-prepare.ts",
      ),
      "concurrent-burst-worker": join(
        packageRoot,
        "src/bench/concurrent-burst-worker.ts",
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

  const cases = datasets.flatMap((dataset) => {
    const label = prepareFixture(dataset);
    return opens.flatMap((open) =>
      depths.map((depth) => ({ dataset, label, open, depth })),
    );
  });

  const runsPath = join(output, "runs.jsonl");
  writeFileSync(runsPath, "");
  const results = [];
  for (const { label, open, depth } of cases) {
    for (let run = 1; run <= runs; run++) {
      const order =
        run % 2 === 1 ? implementations : [...implementations].reverse();
      for (const implementation of order) {
        const name = `${label} ${open} depth=${depth} ${implementation.name} run=${run}`;
        console.error(`START ${name}`);
        const child = spawnSync(
          process.execPath,
          [
            "--expose-gc",
            "--max-old-space-size=6656",
            join(bundleDirectory, "concurrent-burst-worker.mjs"),
            implementation.path,
            fixtures,
            label,
            open,
            String(depth),
            String(edits),
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
          `END ${name} open=${result.openMs.toFixed(1)} edits=${result.edits.map((edit) => edit.ms.toFixed(2)).join(",")}`,
        );
      }
    }
    const hashes = new Set(
      results
        .filter(
          (result) =>
            result.label === label &&
            result.open === open &&
            result.depth === depth,
        )
        .map((result) => result.finalTextSha256),
    );
    assert.equal(
      hashes.size,
      1,
      `${label} ${open} depth=${depth}: final text differs across runs`,
    );
  }

  const summary = formatSummary(cases, results);
  writeFileSync(join(output, "summary.md"), `${summary}\n`);
  console.log(summary);
  console.error(`raw samples: ${runsPath}`);
} finally {
  await rm(bundleDirectory, { force: true, recursive: true });
}

function prepareFixture(dataset) {
  const indexPath = join(fixtures, "index.json");
  const index = existsSync(indexPath)
    ? JSON.parse(readFileSync(indexPath, "utf8"))
    : {};
  const key = `${dataset}@1`;
  const cached = index[key];
  if (
    values["reuse-fixtures"] &&
    cached !== undefined &&
    existsSync(join(fixtures, `${cached}.egwp`)) &&
    depths.every((depth) =>
      Object.hasOwn(
        JSON.parse(readFileSync(join(fixtures, `${cached}.json`), "utf8"))
          .ancestorsByDepth,
        String(depth),
      ),
    )
  ) {
    return cached;
  }
  console.error(`PREPARE ${key}`);
  const child = spawnSync(
    process.execPath,
    [
      "--max-old-space-size=6656",
      join(bundleDirectory, "snapshot-first-edit-prepare.mjs"),
      "--paper-root",
      values["paper-root"],
      "--dataset",
      dataset,
      "--depths",
      depths.join(","),
      "--output",
      fixtures,
    ],
    { encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout },
  );
  if (child.status !== 0) {
    throw new Error(`prepare ${key} failed:\n${child.stderr}`);
  }
  const { label } = JSON.parse(child.stdout.trim().split("\n").at(-1));
  writeFileSync(
    indexPath,
    `${JSON.stringify({ ...index, [key]: label }, null, 2)}\n`,
  );
  return label;
}

function formatSummary(cases, results) {
  const groups = cases.flatMap((testCase) =>
    names.map((name) => ({
      ...testCase,
      name,
      samples: results.filter(
        (result) =>
          result.implementation === name &&
          result.label === testCase.label &&
          result.open === testCase.open &&
          result.depth === testCase.depth,
      ),
    })),
  );
  const caseCells = ({ dataset, open, depth, name }) =>
    `| ${dataset} | ${open === "native" ? "cold load" : "portable"} | ${depth.toLocaleString("en-US")} | ${name} |`;
  const editNumbers = Array.from({ length: edits }, (_, edit) => edit + 1);

  const latency = [
    `| Dataset | Open | Depth | Build | Open (ms) |${editNumbers.map((edit) => ` Edit ${edit} |`).join("")}`,
    `|---|---|---:|---|---:|${editNumbers.map(() => "---:|").join("")}`,
    ...groups.map(
      (group) =>
        `${caseCells(group)} ${formatMs(medianOf(group.samples.map((sample) => sample.openMs)))} |${editNumbers
          .map(
            (edit) =>
              ` ${formatMs(medianOf(group.samples.map((sample) => sample.edits[edit - 1].ms)))} |`,
          )
          .join("")}`,
    ),
  ];

  const work = [
    "| Dataset | Open | Depth | Build | Paths | Full / partial / incremental | Cache releases | Cache kept (events) | Cache estimate | Heap after GC | ArrayBuffers after GC | Peak RSS |",
    "|---|---|---:|---|---|---:|---:|---:|---:|---:|---:|---:|",
    ...groups.map((group) => {
      const median = (read) => medianOf(group.samples.map(read));
      const total = (key) => (sample) =>
        sample.edits.reduce((sum, edit) => sum + edit[key], 0);
      const last = (key) => (sample) => sample.edits.at(-1)[key];
      return `${caseCells(group)} ${paths(group.samples)} | ${[
        median(total("fullReplays")),
        median(total("partialReplays")),
        median(total("incrementalApplies")),
      ].join(" / ")} | ${median(
        (sample) => sample.edits.filter((edit) => edit.cacheReleased).length,
      )} | ${formatCount(median(last("replayCacheEvents")))} | ${formatBytes(
        median(last("replayCacheBytes")),
      )} | ${formatBytes(median((sample) => sample.heapAfterEditsBytes))} | ${formatBytes(
        median((sample) => sample.arrayBuffersAfterEditsBytes),
      )} | ${formatBytes(median((sample) => sample.maxRssKiB * 1024))} |`;
    }),
  ];

  const sections = [
    `### Latency per edit (median of ${runs} processes)`,
    "",
    ...latency,
    "",
    `### Replay work, retained cache and memory after the burst (median of ${runs} processes)`,
    "",
    "Paths: the replay each edit took (F full, P partial, I incremental). A cache release is an edit that replayed history or started with a cache and ended without one.",
    "",
    ...work,
  ];
  if (names.length === 2) {
    sections.push(
      "",
      `### ${names[0]} → ${names[1]}`,
      "",
      ...formatChanges(cases, groups),
    );
  }
  return sections.join("\n");
}

function formatChanges(cases, groups) {
  const metrics = [
    {
      title: "Edit 1",
      read: (sample) => sample.edits[0].ms,
      format: formatMs,
    },
    {
      title: `Slowest of edits 2–${edits}`,
      // The slowest per-edit median, so every later edit is at most this.
      reduce: (samples) =>
        Math.max(
          ...samples[0].edits
            .slice(1)
            .map((_, index) =>
              medianOf(samples.map((sample) => sample.edits[index + 1].ms)),
            ),
        ),
      format: formatMs,
    },
    {
      title: "Heap + ArrayBuffers after GC",
      read: (sample) =>
        sample.heapAfterEditsBytes + sample.arrayBuffersAfterEditsBytes,
      format: formatBytes,
    },
    {
      title: "Peak RSS",
      read: (sample) => sample.maxRssKiB * 1024,
      format: formatBytes,
    },
  ];
  const rows = cases.flatMap(({ dataset, open, depth, label }) =>
    metrics.map((metric) => {
      const values = names.map((name) => {
        const samples = groups.find(
          (group) =>
            group.name === name &&
            group.label === label &&
            group.open === open &&
            group.depth === depth,
        ).samples;
        return metric.reduce === undefined
          ? medianOf(samples.map(metric.read))
          : metric.reduce(samples);
      });
      const change =
        values[0] === 0
          ? "—"
          : `${(((values[1] - values[0]) / values[0]) * 100).toFixed(1)}%`;
      return `| ${dataset} | ${open === "native" ? "cold load" : "portable"} | ${depth.toLocaleString("en-US")} | ${metric.title} |${values.map((value) => ` ${metric.format(value)} |`).join("")} ${change} |`;
    }),
  );
  return [
    `| Dataset | Open | Depth | Metric |${names.map((name) => ` ${name} (median, n=${runs}) |`).join("")} Change |`,
    `|---|---|---:|---|${names.map(() => "---:|").join("")}---:|`,
    ...rows,
  ];
}

/** Each edit's replay path, as the most common sequence across samples. */
function paths(samples) {
  const counts = new Map();
  for (const sample of samples) {
    const sequence = sample.edits
      .map((edit) =>
        edit.fullReplays > 0 ? "F" : edit.partialReplays > 0 ? "P" : "I",
      )
      .join("");
    counts.set(sequence, (counts.get(sequence) ?? 0) + 1);
  }
  return [...counts].sort((left, right) => right[1] - left[1])[0][0];
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
  return value >= 10 ? `${value.toFixed(1)} ms` : `${value.toFixed(2)} ms`;
}

function formatBytes(value) {
  if (value === undefined || Number.isNaN(value)) return "n/a";
  return `${(value / (1024 * 1024)).toFixed(1)} MiB`;
}

function formatCount(value) {
  if (value === undefined || Number.isNaN(value)) return "n/a";
  return Math.round(value).toLocaleString("en-US");
}
