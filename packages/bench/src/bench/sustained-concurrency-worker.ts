/**
 * Measure one sustained-concurrency typing session in this process.
 * `scripts/run-sustained-concurrency-bench.mjs` bundles this worker and
 * starts one fresh process per sample.
 *
 * usage: sustained-concurrency-worker.mjs <eg-walker/dist/index.js>
 *          <writers> <events> <max delay steps> <single|batch> <warm-up events>
 */
import { resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import {
  measureSustainedConcurrency,
  type SustainedConcurrencyApply,
} from "./sustained-concurrency";

const usage =
  "usage: sustained-concurrency-worker.mjs <eg-walker/dist/index.js> <writers> <events> <max delay steps> <single|batch> <warm-up events>";
const [implementation, writersArg, eventsArg, delayArg, applyArg, warmupArg] =
  process.argv.slice(2);
if (
  !implementation ||
  !writersArg ||
  !eventsArg ||
  !delayArg ||
  !applyArg ||
  !warmupArg
) {
  throw new Error(usage);
}

const publicApi = (await import(
  pathToFileURL(resolve(implementation)).href
)) as typeof import("@softmaple/eg-walker");
const result = measureSustainedConcurrency(publicApi, {
  writers: Number(writersArg),
  events: Number(eventsArg),
  maxDelaySteps: Number(delayArg),
  apply: applyArg as SustainedConcurrencyApply,
  warmupEvents: Number(warmupArg),
});
process.stdout.write(`${JSON.stringify(result)}\n`);
