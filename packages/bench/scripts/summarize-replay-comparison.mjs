/** Aggregate raw observations without treating failed validation as a sample. */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";

const root = resolve(process.argv[2] ?? "results/2026-09-06-eg-walker");
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
const summarize = (values) => ({
  median: median(values),
  min: Math.min(...values),
  max: Math.max(...values),
  samples: values,
});
const numericFields = (rows) =>
  Object.fromEntries(
    Object.keys(rows[0] ?? {})
      .filter((key) => rows.every((row) => typeof row[key] === "number"))
      .map((key) => [key, summarize(rows.map((row) => row[key]))]),
  );
const parseMetricLine = (line) =>
  Object.fromEntries(
    line
      .split(" ")
      .slice(1)
      .map((part) => {
        const [key, value] = part.split("=");
        return [
          key,
          value === "true"
            ? true
            : value === "false"
              ? false
              : value !== "none" && Number.isFinite(Number(value))
                ? Number(value)
                : value,
        ];
      }),
  );
const runs = readFileSync(join(root, "full", "runs.jsonl"), "utf8")
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line));
const paper = [];
for (const lane of ["apply", "persistence"]) {
  for (const dataset of ["S1", "S2", "S3", "C1", "C2", "A1", "A2"]) {
    const result = { lane, dataset };
    for (const version of ["before", "after"]) {
      const attempts = runs.filter(
        (row) =>
          row.lane === lane &&
          row.dataset === dataset &&
          row.version === version,
      );
      const samples = [];
      const failures = [];
      for (const attempt of attempts) {
        const log = readFileSync(
          join(root, "full", `${attempt.name}.log`),
          "utf8",
        );
        if (attempt.status !== 0) {
          failures.push({
            ...attempt,
            errorOutput: log
              .split("\n")
              .filter((line) =>
                /mismatch|ERROR|Error|timed out|heap|Killed/.test(line),
              ),
          });
          continue;
        }
        const line = log
          .split("\n")
          .find((entry) => /^paper-bench(?:-apply)? dataset=/.test(entry));
        if (!line) throw new Error(`Missing metrics in ${attempt.name}`);
        samples.push({
          ...parseMetricLine(line),
          processElapsedMs: attempt.elapsedMs,
          maxRssMiB:
            attempt.maxRssKiB === null ? null : attempt.maxRssKiB / 1024,
        });
      }
      result[version] = {
        attempts: attempts.length,
        successes: samples.length,
        failures,
        metrics: numericFields(samples),
        samples,
      };
    }
    if (result.before.successes && result.after.successes) {
      result.applySpeedup =
        result.before.metrics.applyMs.median /
        result.after.metrics.applyMs.median;
    }
    paper.push(result);
  }
}
const focused = [];
for (const file of readdirSync(join(root, "focused")).filter((name) =>
  name.endsWith("-before.jsonl"),
)) {
  const result = { name: file.replace("-before.jsonl", "") };
  for (const version of ["before", "after"]) {
    const rows = readFileSync(
      join(root, "focused", file.replace("-before.jsonl", `-${version}.jsonl`)),
      "utf8",
    )
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    result[version] = {
      metrics: numericFields(rows),
      stats: rows[0].stats,
      samples: rows,
    };
  }
  result.applySpeedup =
    result.before.metrics.applyMs.median / result.after.metrics.applyMs.median;
  result.totalSpeedup =
    result.before.metrics.totalMs.median / result.after.metrics.totalMs.median;
  focused.push(result);
}
writeFileSync(
  join(root, "summary.json"),
  `${JSON.stringify({ paper, focused }, null, 2)}\n`,
);
