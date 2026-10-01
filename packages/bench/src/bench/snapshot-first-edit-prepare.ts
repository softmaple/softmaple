/**
 * Prepare one paper dataset for the snapshot first-edit lanes.
 *
 * usage: snapshot-first-edit-prepare.mjs --paper-root PATH --dataset S1
 *          --output DIR [--fraction 1] [--depths 10,1000]
 *
 * Writes `<label>.egwp` (EGWP1 bytes), `<label>.tag` (their authentication
 * tag under the bench key, for the `trusted` lanes) and `<label>.json`
 * (manifest) to DIR and prints the manifest. A full dataset's text is checked
 * against its final text oracle; a prefix is checked by the snapshot
 * encoder's own replay.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";

import { PortableSnapshotCodec } from "@softmaple/eg-walker";

import { assertFinalText, loadFinalTextOracle } from "./paper-final-text";
import { loadPaperTrace, parseDatasetList } from "./paper-traces";
import { importBenchAuthenticationKey } from "./snapshot-first-edit";
import { buildSnapshotFirstEditFixture } from "./snapshot-first-edit-fixture";

const { values } = parseArgs({
  options: {
    "paper-root": { type: "string" },
    dataset: { type: "string" },
    output: { type: "string" },
    fraction: { type: "string", default: "1" },
    depths: { type: "string", default: "10,1000" },
  },
});

const paperRoot = values["paper-root"];
const output = values.output;
if (paperRoot === undefined || values.dataset === undefined || !output) {
  throw new Error(
    "usage: snapshot-first-edit-prepare.mjs --paper-root PATH --dataset S1 --output DIR [--fraction 1] [--depths 10,1000]",
  );
}
const [dataset] = parseDatasetList(values.dataset);
if (dataset === undefined) {
  throw new Error("--dataset must name one paper dataset");
}
const fraction = Number(values.fraction);
if (!(fraction > 0 && fraction <= 1)) {
  throw new Error(`--fraction must be in (0, 1], got ${values.fraction}`);
}
const depths = values.depths.split(",").map((value) => {
  const depth = Number(value);
  if (!Number.isSafeInteger(depth) || depth < 0) {
    throw new Error(`--depths must list non-negative integers, got ${value}`);
  }
  return depth;
});

const loaded = loadPaperTrace(resolve(paperRoot), dataset, {
  granularity: "operation",
});
// A prefix of the recorded editing order is itself a causally closed history.
const eventCount = Math.round(loaded.events.length * fraction);
const limited = eventCount < loaded.events.length;
const events = limited ? loaded.events.slice(0, eventCount) : loaded.events;
const label = limited ? `${dataset}-events-${eventCount}` : `${dataset}-full`;
const fixture = buildSnapshotFirstEditFixture(label, events, depths);
if (!limited) {
  assertFinalText(
    label,
    fixture.text,
    loadFinalTextOracle(resolve(paperRoot), dataset, loaded.trace.endContent),
  );
}

// The bytes left this process's encoder, so authenticating them proves them
// with one more replay first.
const tag = await new PortableSnapshotCodec().authenticate(
  fixture.bytes,
  await importBenchAuthenticationKey(),
);

mkdirSync(resolve(output), { recursive: true });
writeFileSync(join(resolve(output), `${label}.egwp`), fixture.bytes);
writeFileSync(join(resolve(output), `${label}.tag`), tag);
writeFileSync(
  join(resolve(output), `${label}.json`),
  `${JSON.stringify(fixture.manifest, null, 2)}\n`,
);
process.stdout.write(`${JSON.stringify(fixture.manifest)}\n`);
