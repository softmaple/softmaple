/**
 * Measure one concurrent-burst sample in this process. Run the bundled output
 * with --expose-gc; `scripts/run-concurrent-burst-bench.mjs` prepares the
 * fixtures and starts one fresh process per sample.
 *
 * usage: concurrent-burst-worker.mjs <eg-walker/dist/index.js> <fixture-dir>
 *          <label> <native|portable> <depth> <edits>
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import {
  measureConcurrentBurst,
  parseConcurrentBurstOpen,
  warmUpConcurrentBurst,
  type ConcurrentBurstApi,
} from "./concurrent-burst";
import type { SnapshotFirstEditManifest } from "./snapshot-first-edit";

const usage =
  "usage: concurrent-burst-worker.mjs <eg-walker/dist/index.js> <fixture-dir> <label> <native|portable> <depth> <edits>";
const [implementation, fixtureDirectory, label, openArg, depthArg, editsArg] =
  process.argv.slice(2);
if (
  !implementation ||
  !fixtureDirectory ||
  !label ||
  !openArg ||
  !depthArg ||
  !editsArg
) {
  throw new Error(usage);
}
const collectGarbage = (globalThis as { gc?: () => void }).gc;
if (collectGarbage === undefined) {
  throw new Error("concurrent-burst requires node --expose-gc");
}
const open = parseConcurrentBurstOpen(openArg);
const depth = Number(depthArg);
const edits = Number(editsArg);

const entry = resolve(implementation);
const publicApi = (await import(
  pathToFileURL(entry).href
)) as typeof import("@softmaple/eg-walker");
const internalApi = (await import(
  pathToFileURL(join(dirname(entry), "internal.js")).href
)) as typeof import("@softmaple/eg-walker/internal");
const api: ConcurrentBurstApi = {
  EgWalkerReplica: publicApi.EgWalkerReplica,
  PortableSnapshotCodec: publicApi.PortableSnapshotCodec,
  ColumnarEventGraphCodec: internalApi.ColumnarEventGraphCodec,
};

const bytes = new Uint8Array(
  readFileSync(join(resolve(fixtureDirectory), `${label}.egwp`)),
);
const manifest = JSON.parse(
  readFileSync(join(resolve(fixtureDirectory), `${label}.json`), "utf8"),
) as SnapshotFirstEditManifest;

warmUpConcurrentBurst(api, edits);
const result = measureConcurrentBurst(api, bytes, manifest, {
  open,
  depth,
  edits,
  collectGarbage,
});
process.stdout.write(
  `${JSON.stringify({
    label,
    eventCount: manifest.eventCount,
    ...result,
    maxRssKiB: process.resourceUsage().maxRSS,
  })}\n`,
);
