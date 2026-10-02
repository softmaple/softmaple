/**
 * Measure one wide-frontier receive in this process.
 * `scripts/run-wide-frontier-bench.mjs` bundles this worker and starts one
 * fresh process per sample.
 *
 * usage: wide-frontier-worker.mjs <eg-walker/dist/index.js>
 *          <events> <single|batch> <warm-up events>
 */
import { resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { measureWideFrontier, type WideFrontierApply } from "./wide-frontier";

const usage =
  "usage: wide-frontier-worker.mjs <eg-walker/dist/index.js> <events> <single|batch> <warm-up events>";
const [implementation, eventsArg, applyArg, warmupArg] = process.argv.slice(2);
if (!implementation || !eventsArg || !applyArg || !warmupArg) {
  throw new Error(usage);
}

const publicApi = (await import(
  pathToFileURL(resolve(implementation)).href
)) as typeof import("@softmaple/eg-walker");
const result = measureWideFrontier(publicApi, {
  events: Number(eventsArg),
  apply: applyArg as WideFrontierApply,
  warmupEvents: Number(warmupArg),
});
process.stdout.write(`${JSON.stringify(result)}\n`);
