/** Focused A/B worker. Run compiled output with --expose-gc; fixtures are untimed. */
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
import { createHash } from "node:crypto";
import type { GraphEvent } from "@softmaple/eg-walker";
import {
  buildLongLinearHistory,
  buildConcurrentSameIndexInserts,
  buildLongOfflineBranchMerge,
  buildDeleteHeavyWorkload,
  buildCheckpointTrace,
} from "./traces";

const [
  implementation,
  scenario = "offline-2100",
  sizeArg = "1",
  mode = "detailed",
] = process.argv.slice(2);
if (!implementation)
  throw new Error(
    "usage: replay-optimization.mjs <dist/index.js> <scenario> <batch-size> <detailed|causal|import|snapshot-local|snapshot-remote>",
  );
const {
  EgWalkerReplica,
  PortableSnapshotCodec,
  createCausalEventBatchBuilder,
} = (await import(
  pathToFileURL(resolve(implementation)).href
)) as typeof import("@softmaple/eg-walker");
const size = Number(sizeArg);
if (!Number.isSafeInteger(size) || size <= 0)
  throw new Error("invalid batch size");
const events = scenario.startsWith("offline-")
  ? buildLongOfflineBranchMerge(Number(scenario.slice(8)))
  : scenario === "linear"
    ? buildLongLinearHistory(10_000)
    : scenario === "linear-5000"
      ? buildLongLinearHistory(5_000)
      : scenario === "concurrent"
        ? buildConcurrentSameIndexInserts(200)
        : scenario === "delete"
          ? buildDeleteHeavyWorkload(2_000)
          : scenario === "checkpoint"
            ? buildCheckpointTrace({ linearHistory: 100, siblingCount: 20 })
            : (() => {
                throw new Error(`unknown scenario: ${scenario}`);
              })();

const expected = scenario.startsWith("offline-")
  ? `!${"a".repeat((events.length - 2) / 2)}*${"b".repeat((events.length - 2) / 2)}`
  : scenario.startsWith("linear") || scenario === "delete"
    ? events.reduce(
        (text, { operation: op }) =>
          op.type === "insert"
            ? text.slice(0, op.index) + op.text + text.slice(op.index)
            : text.slice(0, op.index) + text.slice(op.index + op.length),
        "",
      )
    : null;
const prepareCausal = (input: GraphEvent[]) => {
  const builder = createCausalEventBatchBuilder();
  for (const { id, parentVersion, operation: op, timestamp } of input) {
    if (op.type === "insert")
      builder.appendInsert(id, parentVersion, op.index, op.text, timestamp);
    else
      builder.appendDelete(id, parentVersion, op.index, op.length, timestamp);
  }
  return builder.finish();
};
const codec = new PortableSnapshotCodec();
const persisted = mode.startsWith("snapshot-")
  ? (() => {
      const source = new EgWalkerReplica("source");
      source.applyCausalBatch(prepareCausal(events));
      if (expected !== null) assert.equal(source.getText(), expected);
      return codec.encode(source.createPortableSnapshot()).slice();
    })()
  : null;

// Warm the selected API with a small fixture, twice; measured runs use full input.
for (let warmup = 0; warmup < 2; warmup++) {
  const replica = new EgWalkerReplica("warmup");
  const warmEvents = scenario.startsWith("offline-")
    ? buildLongOfflineBranchMerge(200)
    : buildLongLinearHistory(200);
  if (mode === "causal") replica.applyCausalBatch(prepareCausal(warmEvents));
  else if (mode === "import")
    EgWalkerReplica.fromEventGraph("warmup-import", warmEvents);
  else
    for (let i = 0; i < warmEvents.length; i += size) {
      if (size === 1) replica.applyRemoteEvent(warmEvents[i]!);
      else replica.applyRemoteEvents(warmEvents.slice(i, i + size));
    }
  if (persisted !== null) {
    const source = new EgWalkerReplica("warm-snapshot");
    source.applyCausalBatch(prepareCausal(buildLongLinearHistory(200)));
    const restored = EgWalkerReplica.fromPortableSnapshot(
      codec.decode(codec.encode(source.createPortableSnapshot()).slice()),
    );
    restored.insert(0, "!");
  }
}

for (let run = 1; run <= 5; run++) {
  globalThis.gc?.();
  const memoryBefore = process.memoryUsage();
  let replica = new EgWalkerReplica("receiver");
  let builderMs = 0;
  let applyMs = 0;
  let decodeMs = 0;
  let restoreMs = 0;
  let firstEditMs = 0;
  if (persisted !== null) {
    const bytes = persisted.slice(); // A fresh persistence boundary for every trial.
    let start = performance.now();
    const decoded = codec.decode(bytes);
    decodeMs = performance.now() - start;
    start = performance.now();
    replica = EgWalkerReplica.fromPortableSnapshot(decoded, "receiver");
    restoreMs = performance.now() - start;
    const remote: GraphEvent = {
      id: "late:0",
      parentVersion: new Set([events[0]!.id]),
      operation: { type: "insert", index: 0, text: "!" },
      timestamp: 1,
    };
    start = performance.now();
    if (mode === "snapshot-local") replica.insert(0, "!");
    else replica.applyRemoteEvent(remote);
    firstEditMs = performance.now() - start;
  } else if (mode === "import") {
    const start = performance.now();
    replica = EgWalkerReplica.fromEventGraph("receiver", events);
    applyMs = performance.now() - start;
  } else {
    for (let i = 0; i < events.length; i += size) {
      const batch = events.slice(i, i + size);
      const builderStart = mode === "causal" ? performance.now() : 0;
      const causal = mode === "causal" ? prepareCausal(batch) : null;
      if (causal !== null) builderMs += performance.now() - builderStart;
      const start = performance.now();
      if (causal !== null) replica.applyCausalBatch(causal);
      else if (size === 1) replica.applyRemoteEvent(batch[0]!);
      else replica.applyRemoteEvents(batch);
      applyMs += performance.now() - start;
    }
  }
  const materializeStart = performance.now();
  const text = replica.getText();
  const materializeMs = performance.now() - materializeStart;
  if (expected !== null && mode !== "snapshot-remote")
    assert.equal(text, (mode === "snapshot-local" ? "!" : "") + expected);
  assert.equal(replica.getPendingRemoteCount(), 0);
  const stats = replica.getReplayStats();
  globalThis.gc?.();
  console.log(
    JSON.stringify({
      scenario,
      size,
      mode,
      run,
      events: events.length,
      builderMs,
      applyMs,
      materializeMs,
      decodeMs,
      restoreMs,
      firstEditMs,
      totalMs:
        builderMs +
        applyMs +
        materializeMs +
        decodeMs +
        restoreMs +
        firstEditMs,
      finalTextHash: createHash("sha256").update(text).digest("hex"),
      finalTextValidated: expected !== null && mode !== "snapshot-remote",
      stats,
      memoryBefore,
      memoryAfter: process.memoryUsage(),
      maxRssKiB: process.resourceUsage().maxRSS,
    }),
  );
}
