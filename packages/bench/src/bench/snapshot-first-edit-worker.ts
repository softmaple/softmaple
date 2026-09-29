/**
 * Measure one snapshot first-edit lane in this process. Run the bundled
 * output with --expose-gc; `scripts/run-snapshot-first-edit-bench.mjs`
 * prepares the fixtures and starts one fresh process per sample.
 *
 * usage: snapshot-first-edit-worker.mjs <eg-walker/dist/index.js> <fixture-dir>
 *          <label> <local|remote|native|concurrent-<depth>>
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import {
  measureSnapshotFirstEdit,
  parseSnapshotEditKind,
  warmUpSnapshotFirstEdit,
  type SnapshotFirstEditApi,
  type SnapshotFirstEditManifest,
} from "./snapshot-first-edit";

const [implementation, fixtureDirectory, label, kindArg] =
  process.argv.slice(2);
if (!implementation || !fixtureDirectory || !label || !kindArg) {
  throw new Error(
    "usage: snapshot-first-edit-worker.mjs <eg-walker/dist/index.js> <fixture-dir> <label> <kind>",
  );
}
const kind = parseSnapshotEditKind(kindArg);
const entry = resolve(implementation);
const publicApi = (await import(
  pathToFileURL(entry).href
)) as typeof import("@softmaple/eg-walker");
const internalApi = (await import(
  pathToFileURL(join(dirname(entry), "internal.js")).href
)) as typeof import("@softmaple/eg-walker/internal");
const api: SnapshotFirstEditApi = {
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

const collectGarbage = (): void => {
  (globalThis as { gc?: () => void }).gc?.();
};

warmUpSnapshotFirstEdit(api);
const result = measureSnapshotFirstEdit(
  api,
  bytes,
  manifest,
  kind,
  collectGarbage,
);
process.stdout.write(
  `${JSON.stringify({
    label,
    eventCount: manifest.eventCount,
    ...result,
    maxRssKiB: process.resourceUsage().maxRSS,
  })}\n`,
);
