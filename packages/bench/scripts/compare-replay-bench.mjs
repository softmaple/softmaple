import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";
import console from "node:console";

const [worker, before, after, output] = process.argv.slice(2);
if (!worker || !before || !after || !output)
  throw new Error(
    "usage: compare-replay-bench.mjs <worker.mjs> <before/dist/index.js> <after/dist/index.js> <output-dir>",
  );
mkdirSync(output, { recursive: true });
const cases = [
  ...["linear-5000", "concurrent", "offline-1000", "delete", "checkpoint"].map(
    (scenario) => [scenario, 1, "detailed"],
  ),
  ...[2000, 2100].flatMap((depth) =>
    [1, 64, 4096].map((size) => [`offline-${depth}`, size, "detailed"]),
  ),
  ...[1, 64, 4096].map((size) => ["linear", size, "detailed"]),
  ["linear", 4096, "causal"],
  ["linear", 10000, "import"],
  ...["linear", "offline-2100"].flatMap((scenario) =>
    ["snapshot-local", "snapshot-remote"].map((mode) => [scenario, 1, mode]),
  ),
];
for (const [index, [scenario, size, mode]] of cases.entries()) {
  const hashes = new Set();
  for (const version of index % 2 ? ["after", "before"] : ["before", "after"]) {
    const name = `${scenario}-${size}-${mode}-${version}`;
    console.log(`START ${name}`);
    const result = spawnSync(
      process.execPath,
      [
        "--expose-gc",
        resolve(worker),
        resolve(version === "before" ? before : after),
        scenario,
        String(size),
        mode,
      ],
      { encoding: "utf8", timeout: 300_000, maxBuffer: 16 * 1024 * 1024 },
    );
    writeFileSync(join(output, `${name}.jsonl`), result.stdout);
    if (result.stderr)
      writeFileSync(join(output, `${name}.stderr.log`), result.stderr);
    else rmSync(join(output, `${name}.stderr.log`), { force: true });
    assert.equal(result.status, 0, `${name}: ${result.stderr}`);
    for (const row of result.stdout.trim().split("\n"))
      hashes.add(JSON.parse(row).finalTextHash);
    console.log(`END ${name}`);
  }
  assert.equal(hashes.size, 1, `${scenario}: A/B final text diverged`);
}
