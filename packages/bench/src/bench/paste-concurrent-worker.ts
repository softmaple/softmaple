/**
 * Measure one concurrent paste merge in this process.
 * `scripts/run-paste-concurrent-bench.mjs` bundles this worker and starts one
 * fresh `--expose-gc` process per sample.
 *
 * usage: paste-concurrent-worker.mjs <eg-walker/dist/index.js>
 *          <paste-length> <base-length> <warm-up rounds>
 */
import { resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { measurePasteConcurrent } from "./paste-concurrent";

const usage =
  "usage: paste-concurrent-worker.mjs <eg-walker/dist/index.js> <paste-length> <base-length> <warm-up rounds>";
const [implementation, pasteLengthArg, baseLengthArg, warmupArg] =
  process.argv.slice(2);
if (!implementation || !pasteLengthArg || !baseLengthArg || !warmupArg) {
  throw new Error(usage);
}
const collectGarbage = (globalThis as { gc?: () => void }).gc;
if (collectGarbage === undefined) {
  throw new Error("paste-concurrent requires node --expose-gc");
}

const publicApi = (await import(
  pathToFileURL(resolve(implementation)).href
)) as typeof import("@softmaple/eg-walker");
const result = measurePasteConcurrent(publicApi, {
  pasteLength: Number(pasteLengthArg),
  baseLength: Number(baseLengthArg),
  warmup: Number(warmupArg),
  collectGarbage,
});
process.stdout.write(`${JSON.stringify(result)}\n`);
