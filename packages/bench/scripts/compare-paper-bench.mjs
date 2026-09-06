/** Run fixed before/after bundles sequentially; each sample gets a fresh process. */
import process from "node:process";
import console from "node:console";
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";
import { performance } from "node:perf_hooks";

const [before, after, paperRoot, output, lane = "apply", runsArg = "3"] =
  process.argv.slice(2);
if (!before || !after || !paperRoot || !output)
  throw new Error(
    "usage: compare-paper-bench.mjs <before.mjs> <after.mjs> <paper-root> <output-dir> [apply|persistence] [runs]",
  );
const directory = resolve(output);
mkdirSync(directory, { recursive: true });
const runs = Number(runsArg);
if (!Number.isSafeInteger(runs) || runs < 1) throw new Error("invalid runs");
if (lane !== "apply" && lane !== "persistence")
  throw new Error("invalid lane");
for (const dataset of ["S1", "S2", "S3", "C1", "C2", "A1", "A2"]) {
  const failedVersions = new Set();
  for (let run = 1; run <= runs; run++) {
    for (const version of run % 2 ? ["before", "after"] : ["after", "before"]) {
      if (failedVersions.has(version)) continue;
      const name = `${lane}-${dataset}-${version}-${run}`;
      const command = [
        "--expose-gc",
        "--max-old-space-size=6656",
        fileURLToPath(new URL("./benchmark-worker.mjs", import.meta.url)),
        resolve(version === "before" ? before : after),
        "--paper-root",
        resolve(paperRoot),
        "--datasets",
        dataset,
        "--runs",
        "1",
        "--apply-batch-events",
        "4096",
        ...(lane === "apply" ? ["--apply-only", "--apply-api", "causal"] : []),
      ];
      console.log(`START ${name}`);
      const start = performance.now();
      const result = spawnSync(
        "timeout",
        ["--kill-after=5s", "600s", process.execPath, ...command],
        { encoding: "utf8", timeout: 610_000, maxBuffer: 16 * 1024 * 1024 },
      );
      writeFileSync(
        join(directory, `${name}.log`),
        `${result.stdout ?? ""}${result.stderr ?? ""}`,
      );
      const summary = {
        name,
        lane,
        dataset,
        version,
        run,
        command: [process.execPath, ...command],
        elapsedMs: performance.now() - start,
        status: result.status,
        signal: result.signal,
        error: result.error?.message,
        maxRssKiB:
          Number(result.stderr?.match(/BENCH_MAX_RSS_KIB=(\d+)/)?.[1]) || null,
      };
      appendFileSync(
        join(directory, "runs.jsonl"),
        `${JSON.stringify(summary)}\n`,
      );
      if (result.status !== 0) failedVersions.add(version);
      console.log(
        `END ${name} status=${result.status} ms=${summary.elapsedMs.toFixed(0)}`,
      );
    }
  }
}
