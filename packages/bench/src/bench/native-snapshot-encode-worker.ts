/**
 * Time each step of writing a native (EGWS1) snapshot in this process, from
 * a replica cold-loaded from a decoded EGW4 graph. Run the bundled output
 * with --expose-gc; `scripts/run-native-snapshot-encode-bench.mjs` prepares
 * the fixtures and starts one fresh process per sample.
 *
 * usage: native-snapshot-encode-worker.mjs <eg-walker/dist/index.js>
 *          <fixture-dir> <label>
 *
 * Steps, each timed once after a GC:
 * - `nativeCreateEncodeMs`: `createNativeSnapshot()` + `NativeSnapshotCodec.encode`;
 * - `serializeMs`: `graph.serialize()`, the object graph the snapshot used
 *   to carry;
 * - `deserializeMs`: `EventGraph.deserialize()` of that object graph, the
 *   check `encode()` used to run;
 * - `encodeTopologicalBinaryMs`: `graph.encodeTopologicalBinary()` alone;
 * - `portableCreateEncodeMs`: `createPortableSnapshot()` +
 *   `PortableSnapshotCodec.encode`.
 *
 * The native bytes are then decoded and restored; the restored text must
 * match the fixture and the restore must not replay history.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import process from "node:process";
import { pathToFileURL } from "node:url";

import type { SerializedGraphInput } from "@softmaple/eg-walker";

import {
  sha256Hex,
  type SnapshotFirstEditManifest,
} from "./snapshot-first-edit";

const [implementation, fixtureDirectory, label] = process.argv.slice(2);
if (!implementation || !fixtureDirectory || !label) {
  throw new Error(
    "usage: native-snapshot-encode-worker.mjs <eg-walker/dist/index.js> <fixture-dir> <label>",
  );
}
const entry = resolve(implementation);
const publicApi = (await import(
  pathToFileURL(entry).href
)) as typeof import("@softmaple/eg-walker");
const internalApi = (await import(
  pathToFileURL(join(dirname(entry), "internal.js")).href
)) as typeof import("@softmaple/eg-walker/internal");
const { EgWalkerReplica, NativeSnapshotCodec, PortableSnapshotCodec } =
  publicApi;

const bytes = new Uint8Array(
  readFileSync(join(resolve(fixtureDirectory), `${label}.egwp`)),
);
const manifest = JSON.parse(
  readFileSync(join(resolve(fixtureDirectory), `${label}.json`), "utf8"),
) as SnapshotFirstEditManifest;

const collectGarbage = (): void => {
  (globalThis as { gc?: () => void }).gc?.();
};

const time = <T>(run: () => T): { readonly value: T; readonly ms: number } => {
  collectGarbage();
  const startedAt = performance.now();
  const value = run();
  return { value, ms: performance.now() - startedAt };
};

const portable = new PortableSnapshotCodec().decode(bytes);
const graph = new internalApi.ColumnarEventGraphCodec().decodeBinary(
  portable.eventGraph,
);
const replica = new EgWalkerReplica(
  `native-snapshot-encode:${label}`,
  portable.initialText,
  graph,
);
if (sha256Hex(replica.getText()) !== manifest.textSha256) {
  throw new Error(`${label}: cold load text mismatch`);
}

const nativeCodec = new NativeSnapshotCodec();
const native = time(() => nativeCodec.encode(replica.createNativeSnapshot()));
const serialized = time(() => graph.serialize());
const EventGraph = graph.constructor as unknown as {
  deserialize(data: SerializedGraphInput): unknown;
};
const deserialized = time(() => EventGraph.deserialize(serialized.value));
const topological = time(() => {
  try {
    return graph.encodeTopologicalBinary().binary;
  } finally {
    graph.releaseTraversalCaches();
  }
});
const portableCodec = new PortableSnapshotCodec();
const portableEncoded = time(() =>
  portableCodec.encode(replica.createPortableSnapshot()),
);

// The bytes cross a persistence boundary before they are restored.
const decodedAt = performance.now();
const decoded = nativeCodec.decode(native.value.slice());
const restoreStartedAt = performance.now();
const restored = EgWalkerReplica.fromNativeSnapshot(
  decoded,
  `native-snapshot-restore:${label}`,
);
const restoredAt = performance.now();
const restoredText = restored.getText();
if (sha256Hex(restoredText) !== manifest.textSha256) {
  throw new Error(`${label}: native snapshot restore text mismatch`);
}
const stats = restored.getReplayStats();
if (stats.fullReplays !== 0) {
  throw new Error(
    `${label}: native snapshot restore performed ${stats.fullReplays} full replay(s)`,
  );
}

process.stdout.write(
  `${JSON.stringify({
    label,
    eventCount: manifest.eventCount,
    nativeCreateEncodeMs: native.ms,
    serializeMs: serialized.ms,
    deserializeMs: deserialized.ms,
    encodeTopologicalBinaryMs: topological.ms,
    portableCreateEncodeMs: portableEncoded.ms,
    nativeDecodeMs: restoreStartedAt - decodedAt,
    nativeRestoreMs: restoredAt - restoreStartedAt,
    nativeBytes: native.value.byteLength,
    egw4Bytes: topological.value.byteLength,
    nativeFullReplays: stats.fullReplays,
    finalTextSha256: sha256Hex(restoredText),
    maxRssKiB: process.resourceUsage().maxRSS,
  })}\n`,
);
