/**
 * Measure repeated whole-trace ingest in this process.
 * `scripts/run-repeated-ingest-bench.mjs` bundles this worker and starts one
 * fresh process per sample.
 *
 * usage: repeated-ingest-worker.mjs <eg-walker/dist/index.js> <paper-root>
 *          <dataset> <iterations> <all|batch-events> [--retain-replicas]
 */
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { parsePaperBenchmarkApplyBatchEvents } from "./paper-bench-options";
import { loadFinalTextOracle } from "./paper-final-text";
import { parseDatasetList, readPaperTrace } from "./paper-traces";
import {
  measureRepeatedIngest,
  type RepeatedIngestApi,
} from "./repeated-ingest";

const usage =
  "usage: repeated-ingest-worker.mjs <eg-walker/dist/index.js> <paper-root> <dataset> <iterations> <all|batch-events> [--retain-replicas]";
const [
  implementation,
  paperRoot,
  datasetArg,
  iterationsArg,
  batchEventsArg,
  ...flags
] = process.argv.slice(2);
if (
  !implementation ||
  !paperRoot ||
  !datasetArg ||
  !iterationsArg ||
  !batchEventsArg ||
  flags.some((flag) => flag !== "--retain-replicas")
) {
  throw new Error(usage);
}
const datasets = parseDatasetList(datasetArg);
const dataset = datasets[0];
if (dataset === undefined || datasets.length !== 1) {
  throw new Error(`${usage}\nexpected one dataset, got ${datasetArg}`);
}
const iterations = Number(iterationsArg);
const batchEvents = parsePaperBenchmarkApplyBatchEvents(batchEventsArg);
const retainReplicas = flags.includes("--retain-replicas");

const entry = resolve(implementation);
const publicApi = (await import(
  pathToFileURL(entry).href
)) as typeof import("@softmaple/eg-walker");
const internalApi = (await import(
  pathToFileURL(join(dirname(entry), "internal.js")).href
)) as typeof import("@softmaple/eg-walker/internal");
const api: RepeatedIngestApi = {
  EgWalkerReplica: publicApi.EgWalkerReplica,
  createCausalEventBatchBuilder: publicApi.createCausalEventBatchBuilder,
  convertPaperTraceToAtomicSink: internalApi.convertPaperTraceToAtomicSink,
};

const trace = readPaperTrace(paperRoot, dataset);
const oracle = loadFinalTextOracle(paperRoot, dataset, trace.endContent);
const results = await measureRepeatedIngest(api, {
  dataset,
  trace,
  oracle,
  iterations,
  batchEvents,
  retainReplicas,
});
process.stdout.write(
  `${JSON.stringify({
    dataset,
    batchEvents,
    retainReplicas,
    finalTextOracle: oracle.kind,
    iterations: results,
    maxRssKiB: process.resourceUsage().maxRSS,
  })}\n`,
);
