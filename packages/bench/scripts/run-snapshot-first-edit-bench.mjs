/**
 * First-edit latency after `EgWalkerReplica.fromPortableSnapshot`, or after a
 * cold load of the decoded EGW3 graph, on the paper datasets. Prepares one
 * EGWP1 snapshot per dataset (and prefix) with this checkout's eg-walker, then
 * measures every lane in a fresh process per sample, alternating
 * implementation order between runs.
 *
 * usage: node scripts/run-snapshot-first-edit-bench.mjs
 *   [--impl name=path/to/eg-walker/dist/index.js]...
 *   [--datasets S1,C1,A1,A2] [--fractions 1]
 *   [--kinds native,local,remote,concurrent-10,concurrent-1000]
 *   [--runs 3] [--paper-root PATH] [--output DIR] [--reuse-fixtures]
 *
 * `--kinds` also accepts `native-concurrent-<depth>`: cold load, then one
 * concurrent remote edit at that depth.
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
    fractions: { type: "string", default: "1" },
    kinds: {
      type: "string",
      default: "native,local,remote,concurrent-10,concurrent-1000",
    },
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
const fractions = values.fractions.split(",").map(Number);
const kinds = values.kinds.split(",").map((value) => value.trim());
const depths = [
  ...new Set(
    kinds.flatMap((kind) => {
      const match = /^(?:native-)?concurrent-(\d+)$/.exec(kind);
      return match === null ? [] : [Number(match[1])];
    }),
  ),
];
const runs = Number(values.runs);
if (!Number.isSafeInteger(runs) || runs < 1) {
  throw new Error("--runs must be a positive integer");
}
const timeout = Number(values["timeout-minutes"]) * 60_000;
const output = resolve(
  values.output ?? (await mkdtemp(join(tmpdir(), "snapshot-first-edit-"))),
);
const fixtures = join(output, "fixtures");
mkdirSync(fixtures, { recursive: true });

const bundleDirectory = await mkdtemp(
  join(tmpdir(), "snapshot-first-edit-bundle-"),
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
      "snapshot-first-edit-worker": join(
        packageRoot,
        "src/bench/snapshot-first-edit-worker.ts",
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

  const cases = [];
  for (const dataset of datasets) {
    for (const fraction of fractions) {
      cases.push({
        dataset,
        fraction,
        label: prepareFixture(dataset, fraction),
      });
    }
  }

  const results = [];
  for (const { label } of cases) {
    for (const kind of kinds) {
      for (let run = 1; run <= runs; run++) {
        const order =
          run % 2 === 1 ? implementations : [...implementations].reverse();
        for (const implementation of order) {
          const name = `${label} ${kind} ${implementation.name} run=${run}`;
          console.error(`START ${name}`);
          const child = spawnSync(
            process.execPath,
            [
              "--expose-gc",
              "--max-old-space-size=6656",
              join(bundleDirectory, "snapshot-first-edit-worker.mjs"),
              implementation.path,
              fixtures,
              label,
              kind,
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
            `END ${name} decode=${result.decodeMs.toFixed(1)} restore=${result.restoreMs.toFixed(1)} first=${result.firstEditMs.toFixed(1)} second=${result.secondEditMs.toFixed(3)} nativeLoad=${result.nativeLoadMs.toFixed(1)}`,
          );
        }
      }
      const hashes = new Set(
        results
          .filter((result) => result.label === label && result.kind === kind)
          .map((result) => result.finalTextSha256),
      );
      assert.equal(
        hashes.size,
        1,
        `${label} ${kind}: final text differs across runs`,
      );
    }
  }

  const table = formatTable(cases, results);
  writeFileSync(join(output, "summary.md"), `${table}\n`);
  console.log(table);
  console.error(`raw samples: ${join(output, "runs.jsonl")}`);
} finally {
  await rm(bundleDirectory, { force: true, recursive: true });
}

function prepareFixture(dataset, fraction) {
  const indexPath = join(fixtures, "index.json");
  const index = existsSync(indexPath)
    ? JSON.parse(readFileSync(indexPath, "utf8"))
    : {};
  const key = `${dataset}@${fraction}`;
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
      "--fraction",
      String(fraction),
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

function formatTable(cases, results) {
  const lanes = [
    { title: "Snapshot decode", kind: null, key: "decodeMs" },
    { title: "Restore (`fromPortableSnapshot`)", kind: null, key: "restoreMs" },
    {
      title: "Cold load of the same EGW3 (`nativeLoadMs`)",
      kind: "native",
      key: "nativeLoadMs",
    },
    {
      title: "Heap after GC, after the cold load",
      kind: "native",
      key: "heapAfterOpenBytes",
      format: formatBytes,
    },
    {
      title: "Checkpoint text retained after the cold load",
      kind: "native",
      key: "statsAfterOpen.checkpointUniqueTextBytes",
      format: formatBytes,
    },
    ...kinds
      .filter((kind) => kind !== "native")
      .flatMap((kind) => [
        {
          title: `First edit: ${describeKind(kind)}`,
          kind,
          key: "firstEditMs",
        },
        ...(kind.startsWith("native-")
          ? [
              {
                title: `Events replayed by the first edit: ${describeKind(kind)}`,
                kind,
                key: "statsAfterFirstEdit.replayCacheEvents",
                format: formatCount,
              },
            ]
          : []),
        {
          title: `Second edit: ${describeKind(kind)}`,
          kind,
          key: "secondEditMs",
        },
        ...(kind.startsWith("native-")
          ? [
              {
                title: `Heap after GC, after both edits: ${describeKind(kind)}`,
                kind,
                key: "heapAfterGcBytes",
                format: formatBytes,
              },
            ]
          : []),
      ]),
  ];
  const header = `| Case | Lane |${names.map((name) => ` ${name} (median, n=${runs}) |`).join("")}${names.length === 2 ? " Change |" : ""}`;
  const divider = `|---|---|${names.map(() => "---:|").join("")}${names.length === 2 ? "---:|" : ""}`;
  const rows = [];
  for (const { label } of cases) {
    for (const lane of lanes) {
      if (lane.kind !== null && !kinds.includes(lane.kind)) continue;
      if (
        lane.kind === null &&
        !kinds.some((kind) => kind !== "native" && !kind.startsWith("native-"))
      ) {
        continue;
      }
      const medians = names.map((name) =>
        medianOf(
          results
            .filter(
              (result) =>
                result.implementation === name &&
                result.label === label &&
                (lane.kind === null
                  ? result.kind !== "native" &&
                    !result.kind.startsWith("native-")
                  : result.kind === lane.kind),
            )
            .map((result) => valueAt(result, lane.key)),
        ),
      );
      const change =
        medians.length === 2
          ? ` ${(((medians[1] - medians[0]) / medians[0]) * 100).toFixed(1)}% |`
          : "";
      const format = lane.format ?? formatMs;
      rows.push(
        `| ${label} | ${lane.title} |${medians.map((value) => ` ${format(value)} |`).join("")}${change}`,
      );
    }
  }
  return [header, divider, ...rows].join("\n");
}

function describeKind(kind) {
  if (kind === "local") return "local";
  if (kind === "remote") return "remote, linear";
  const match = /^(native-)?concurrent-(\d+)$/.exec(kind);
  const depth = Number(match[2]).toLocaleString("en-US");
  return match[1] === undefined
    ? `remote, concurrent at depth ${depth}`
    : `remote, concurrent at depth ${depth}, after a cold load`;
}

function valueAt(result, key) {
  return key.split(".").reduce((value, part) => value?.[part], result);
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

function formatBytes(value) {
  if (value === undefined || Number.isNaN(value)) return "n/a";
  return `${(value / (1024 * 1024)).toFixed(1)} MiB`;
}

function formatCount(value) {
  if (value === undefined || Number.isNaN(value)) return "n/a";
  return Math.round(value).toLocaleString("en-US");
}
