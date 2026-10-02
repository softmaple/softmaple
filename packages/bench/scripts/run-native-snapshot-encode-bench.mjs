/**
 * Native (EGWS1) snapshot write cost on the paper datasets, step by step:
 * `createNativeSnapshot()` + `NativeSnapshotCodec.encode`, `graph.serialize()`,
 * `EventGraph.deserialize()`, `encodeTopologicalBinary()` alone, and the
 * portable create + encode for comparison. Each sample runs in a fresh
 * process from a replica cold-loaded from a decoded EGW4 graph, alternating
 * implementation order between runs. Fixtures are the EGWP1 snapshots of
 * `run-snapshot-first-edit-bench.mjs`, built with this checkout's eg-walker.
 *
 * usage: node scripts/run-native-snapshot-encode-bench.mjs
 *   [--impl name=path/to/eg-walker/dist/index.js]...
 *   [--datasets S1,S3,C1,A2] [--runs 3] [--paper-root PATH] [--output DIR]
 *   [--reuse-fixtures]
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
    datasets: { type: "string", default: "S1,S3,C1,A2" },
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
const runs = Number(values.runs);
if (!Number.isSafeInteger(runs) || runs < 1) {
  throw new Error("--runs must be a positive integer");
}
const timeout = Number(values["timeout-minutes"]) * 60_000;
const output = resolve(
  values.output ?? (await mkdtemp(join(tmpdir(), "native-snapshot-encode-"))),
);
const fixtures = join(output, "fixtures");
mkdirSync(fixtures, { recursive: true });

const LANES = [
  ["`graph.serialize()`", "serializeMs"],
  ["`EventGraph.deserialize()`", "deserializeMs"],
  ["Native create + encode, total", "nativeCreateEncodeMs"],
  ["`encodeTopologicalBinary()` alone", "encodeTopologicalBinaryMs"],
  ["Portable create + encode", "portableCreateEncodeMs"],
  ["Native decode", "nativeDecodeMs"],
  ["Native restore", "nativeRestoreMs"],
];

const bundleDirectory = await mkdtemp(
  join(tmpdir(), "native-snapshot-encode-bundle-"),
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
      "native-snapshot-encode-worker": join(
        packageRoot,
        "src/bench/native-snapshot-encode-worker.ts",
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

  const labels = datasets.map(prepareFixture);
  const results = [];
  for (const label of labels) {
    for (let run = 1; run <= runs; run++) {
      const order =
        run % 2 === 1 ? implementations : [...implementations].reverse();
      for (const implementation of order) {
        const name = `${label} ${implementation.name} run=${run}`;
        console.error(`START ${name}`);
        const child = spawnSync(
          process.execPath,
          [
            "--expose-gc",
            "--max-old-space-size=6656",
            join(bundleDirectory, "native-snapshot-encode-worker.mjs"),
            implementation.path,
            fixtures,
            label,
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
        console.error(
          `END ${name} ${LANES.map(([, key]) => `${key}=${result[key].toFixed(1)}`).join(" ")}`,
        );
      }
    }
    const hashes = new Set(
      results
        .filter((result) => result.label === label)
        .map((result) => result.finalTextSha256),
    );
    assert.equal(hashes.size, 1, `${label}: final text differs across runs`);
  }

  const table = formatTable(labels, results);
  writeFileSync(join(output, "summary.md"), `${table}\n`);
  console.log(table);
  console.error(`raw samples: ${join(output, "runs.jsonl")}`);
} finally {
  await rm(bundleDirectory, { force: true, recursive: true });
}

function prepareFixture(dataset) {
  const indexPath = join(fixtures, "index.json");
  const index = existsSync(indexPath)
    ? JSON.parse(readFileSync(indexPath, "utf8"))
    : {};
  const cached = index[dataset];
  if (
    values["reuse-fixtures"] &&
    cached !== undefined &&
    existsSync(join(fixtures, `${cached}.egwp`)) &&
    existsSync(join(fixtures, `${cached}.json`))
  ) {
    return cached;
  }
  console.error(`PREPARE ${dataset}`);
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
      "1",
      "--output",
      fixtures,
    ],
    { encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout },
  );
  if (child.status !== 0) {
    throw new Error(`prepare ${dataset} failed:\n${child.stderr}`);
  }
  const { label } = JSON.parse(child.stdout.trim().split("\n").at(-1));
  writeFileSync(
    indexPath,
    `${JSON.stringify({ ...index, [dataset]: label }, null, 2)}\n`,
  );
  return label;
}

function formatTable(labels, results) {
  const header = `| Case | Step |${names.map((name) => ` ${name} (median, n=${runs}) |`).join("")}${names.length === 2 ? " Change |" : ""}`;
  const divider = `|---|---|${names.map(() => "---:|").join("")}${names.length === 2 ? "---:|" : ""}`;
  const rows = [];
  for (const label of labels) {
    for (const [title, key] of LANES) {
      const medians = names.map((name) =>
        medianOf(
          results
            .filter(
              (result) =>
                result.implementation === name && result.label === label,
            )
            .map((result) => result[key]),
        ),
      );
      const change =
        medians.length === 2
          ? ` ${(((medians[1] - medians[0]) / medians[0]) * 100).toFixed(1)}% |`
          : "";
      rows.push(
        `| ${label} | ${title} |${medians.map((value) => ` ${formatMs(value)} |`).join("")}${change}`,
      );
    }
  }
  return [header, divider, ...rows].join("\n");
}

function medianOf(samples) {
  const sorted = [...samples].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function formatMs(value) {
  return `${value.toLocaleString("en-US", { maximumFractionDigits: value < 100 ? 1 : 0 })} ms`;
}
