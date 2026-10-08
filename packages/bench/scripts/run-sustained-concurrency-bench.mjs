/**
 * Live typing under sustained concurrency. Each sample starts a fresh process
 * per implementation: `--writers` replicas type `--events` letters in all,
 * one per writer and step, and every edit reaches the other writers and a
 * relay one to `--max-delay` steps later, one `applyRemoteEvent` at a time
 * (`single`) or one `applyRemoteEvents` batch per writer and step (`batch`). Reports the
 * time in replica calls, in receives and in the relay's receives, the time
 * per typed letter and how it grows with the session, and the replay counters
 * summed over the replicas, alternating implementation order between runs.
 * Every implementation and API must produce the same text for a given writer
 * and event count.
 *
 * usage: node scripts/run-sustained-concurrency-bench.mjs
 *   [--impl name=path/to/eg-walker/dist/index.js]...
 *   [--writers 2,3] [--events 2000,4000,8000] [--max-delay 10]
 *   [--apis single,batch] [--warmup-events 1000] [--runs 3] [--output DIR]
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

const APIS = ["single", "batch"];

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const { values } = parseArgs({
  options: {
    impl: { type: "string", multiple: true },
    writers: { type: "string", default: "2,3" },
    events: { type: "string", default: "2000,4000,8000" },
    "max-delay": { type: "string", default: "10" },
    apis: { type: "string", default: APIS.join(",") },
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
const writerCounts = values.writers.split(",").map((value) => {
  const writers = positiveInteger(value.trim(), "--writers");
  if (writers < 2) {
    throw new Error(`--writers needs at least 2 writers, got ${writers}`);
  }
  return writers;
});
const eventCounts = values.events
  .split(",")
  .map((value) => positiveInteger(value.trim(), "--events"));
const maxDelay = positiveInteger(values["max-delay"], "--max-delay");
const apis = values.apis.split(",").map((value) => {
  const api = value.trim();
  if (!APIS.includes(api)) {
    throw new Error(`--apis expects ${APIS.join(" or ")}, got ${api}`);
  }
  return api;
});
const warmupEvents = nonNegativeInteger(
  values["warmup-events"],
  "--warmup-events",
);
const runs = positiveInteger(values.runs, "--runs");
const timeout = Number(values["timeout-minutes"]) * 60_000;
const output = resolve(
  values.output ?? (await mkdtemp(join(tmpdir(), "sustained-concurrency-"))),
);
mkdirSync(output, { recursive: true });

const bundleDirectory = await mkdtemp(
  join(tmpdir(), "sustained-concurrency-bundle-"),
);
try {
  await build({
    clean: true,
    dts: false,
    entry: {
      "sustained-concurrency-worker": join(
        packageRoot,
        "src/bench/sustained-concurrency-worker.ts",
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
  for (const writers of writerCounts) {
    for (const events of eventCounts) {
      for (const api of apis) {
        for (let run = 1; run <= runs; run++) {
          const order =
            run % 2 === 1 ? implementations : [...implementations].reverse();
          for (const implementation of order) {
            const name = `writers=${writers} events=${events} api=${api} ${implementation.name} run=${run}`;
            console.error(`START ${name}`);
            const child = spawnSync(
              process.execPath,
              [
                join(bundleDirectory, "sustained-concurrency-worker.mjs"),
                implementation.path,
                String(writers),
                String(events),
                String(maxDelay),
                api,
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
            const key = `${writers}:${events}`;
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
              `END ${name} total=${result.totalMs.toFixed(1)} ms full-replays=${result.fullReplays} cache-releases=${result.replayCacheEvictions}`,
            );
          }
        }
      }
    }
  }

  const summary = `Edits arrive 1 to ${maxDelay} steps after they are typed.\n\n${formatTable(results)}`;
  writeFileSync(join(output, "summary.md"), `${summary}\n`);
  console.log(summary);
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
  const medianFor = (name, writers, api, events, read) =>
    medianOf(
      results
        .filter(
          (result) =>
            result.implementation === name &&
            result.writers === writers &&
            result.apply === api &&
            result.events === events,
        )
        .map(read),
    );
  const milliseconds = (value) => `${value.toFixed(1)} ms`;
  const count = (value) => String(value);
  const metrics = [
    { title: "Total", read: (result) => result.totalMs, format: milliseconds },
    {
      title: "Receive",
      read: (result) => result.receiveMs,
      format: milliseconds,
    },
    {
      title: "Relay receive",
      read: (result) => result.relayReceiveMs,
      format: milliseconds,
    },
    {
      title: "Per event",
      read: (result) => result.perEventUs,
      format: (value) => `${value.toFixed(1)} µs`,
    },
    {
      title: "Full replays",
      read: (result) => result.fullReplays,
      format: count,
    },
    {
      title: "Partial replays",
      read: (result) => result.partialReplays,
      format: count,
    },
    {
      title: "Cache releases",
      read: (result) => result.replayCacheEvictions,
      format: count,
    },
  ];
  const header = `| Writers | Events | API | Metric |${names.map((name) => ` ${name} (median, n=${runs}) |`).join("")}${names.length === 2 ? " Change |" : ""}`;
  const divider = `|---:|---:|---|---|${names.map(() => "---:|").join("")}${names.length === 2 ? "---:|" : ""}`;
  const rows = writerCounts.flatMap((writers) =>
    eventCounts.flatMap((events) =>
      apis.flatMap((api) => {
        const metricRows = metrics.map((metric) => {
          const medians = names.map((name) =>
            medianFor(name, writers, api, events, metric.read),
          );
          return formatRow(
            writers,
            events,
            api,
            metric.title,
            medians,
            metric.format,
          );
        });
        // How much a typed letter costs in this session relative to the
        // shortest one; a session linear in its length stays near 1.
        const scaling = names.map(
          (name) =>
            medianFor(name, writers, api, events, (result) => result.perEventUs) /
            medianFor(name, writers, api, smallest, (result) => result.perEventUs),
        );
        return [
          ...metricRows,
          formatRow(
            writers,
            events,
            api,
            `Per event ÷ per event at ${smallest}`,
            scaling,
            (value) => `${value.toFixed(2)}×`,
          ),
        ];
      }),
    ),
  );
  return [header, divider, ...rows].join("\n");
}

function formatRow(writers, events, api, title, medians, format) {
  const change =
    medians.length !== 2
      ? ""
      : medians[0] === 0
        ? " — |"
        : ` ${(((medians[1] - medians[0]) / Math.abs(medians[0])) * 100).toFixed(1)}% |`;
  return `| ${writers} | ${events} | ${api} | ${title} |${medians.map((value) => ` ${format(value)} |`).join("")}${change}`;
}

function medianOf(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = sorted.length >> 1;
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}
