/**
 * Measure retained memory per local keystroke in this process.
 * `scripts/run-local-keystroke-memory-bench.mjs` bundles this worker and
 * starts one fresh `--expose-gc` process per sample.
 *
 * usage: local-keystroke-memory-worker.mjs <eg-walker/dist/index.js>
 *          <count> <append|middle>
 */
import { resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import {
  measureLocalKeystrokeMemory,
  parseLocalKeystrokeMode,
} from "./local-keystroke-memory";

const usage =
  "usage: local-keystroke-memory-worker.mjs <eg-walker/dist/index.js> <count> <append|middle>";
const [implementation, countArg, modeArg] = process.argv.slice(2);
if (!implementation || !countArg || !modeArg) {
  throw new Error(usage);
}
const collectGarbage = (globalThis as { gc?: () => void }).gc;
if (collectGarbage === undefined) {
  throw new Error("local keystroke memory requires node --expose-gc");
}

const publicApi = (await import(
  pathToFileURL(resolve(implementation)).href
)) as typeof import("@softmaple/eg-walker");
const result = measureLocalKeystrokeMemory(publicApi, {
  count: Number(countArg),
  mode: parseLocalKeystrokeMode(modeArg),
  collectGarbage,
});
process.stdout.write(`${JSON.stringify(result)}\n`);
