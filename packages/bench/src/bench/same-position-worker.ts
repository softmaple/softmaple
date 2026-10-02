/**
 * Measure one same-position cold replay in this process.
 * `scripts/run-same-position-bench.mjs` bundles this worker and starts one
 * fresh process per sample.
 *
 * usage: same-position-worker.mjs <eg-walker/dist/index.js>
 *          <events> <root|after|before> <warm-up events>
 */
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { measureSamePosition, type SamePositionShape } from "./same-position";

const usage =
  "usage: same-position-worker.mjs <eg-walker/dist/index.js> <events> <root|after|before> <warm-up events>";
const [implementation, eventsArg, shapeArg, warmupArg] = process.argv.slice(2);
if (!implementation || !eventsArg || !shapeArg || !warmupArg) {
  throw new Error(usage);
}

const entry = resolve(implementation);
const publicApi = (await import(
  pathToFileURL(entry).href
)) as typeof import("@softmaple/eg-walker");
const internalApi = (await import(
  pathToFileURL(join(dirname(entry), "internal.js")).href
)) as typeof import("@softmaple/eg-walker/internal");
const result = measureSamePosition(
  {
    EgWalkerReplica: publicApi.EgWalkerReplica,
    ColumnarEventGraphCodec: internalApi.ColumnarEventGraphCodec,
    encodeTopologicallyOrderedEventsBinary:
      internalApi.encodeTopologicallyOrderedEventsBinary,
  },
  {
    events: Number(eventsArg),
    shape: shapeArg as SamePositionShape,
    warmupEvents: Number(warmupArg),
  },
);
process.stdout.write(`${JSON.stringify(result)}\n`);
