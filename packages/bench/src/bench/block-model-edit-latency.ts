/**
 * One-character edit latency on a BlockReplica that already holds a long
 * history, through three entry points: `transact(insertText)`, a remote
 * `applyRemoteEvents`, and `transact(replaceDocument)` as the Lexical binding
 * commits every editor update. A fourth lane then joins a block and toggles
 * bold on one character, so every mark it sets has a join in its past. Run
 * the bundled output with --expose-gc, one process per sample set;
 * `scripts/run-block-model-bench.mjs` drives it.
 *
 * usage: block-model-edit-latency.mjs <block-model/dist/index.js> <batches>
 *          [samples] [paragraph-length]
 */
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import process from "node:process";
import { pathToFileURL } from "node:url";

import {
  buildRemoteTypingBatch,
  buildTypingHistory,
  median,
} from "./block-model-history";

const [
  implementation,
  batchesArg = "3200",
  samplesArg = "21",
  paragraphArg = "0",
] = process.argv.slice(2);
if (!implementation) {
  throw new Error(
    "usage: block-model-edit-latency.mjs <block-model/dist/index.js> <batches> [samples] [paragraph-length]",
  );
}
const batchCount = Number(batchesArg);
const samples = Number(samplesArg);
const paragraphLength = Number(paragraphArg);
for (const [name, value] of [
  ["batches", batchCount],
  ["samples", samples],
  ["paragraph-length", paragraphLength],
] as const) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`invalid ${name}: ${value}`);
  }
}

const model = (await import(
  pathToFileURL(resolve(implementation)).href
)) as typeof import("@softmaple/block-model");
const WARMUP_EDITS = 10;

const history = buildTypingHistory(model, batchCount, paragraphLength);
const replica = new model.BlockReplica("receiver");
globalThis.gc?.();
const setupStart = performance.now();
// One bulk delivery keeps setup linear in the history on every build.
replica.applyRemoteEvents(history.batches);
const setupMs = performance.now() - setupStart;
assert.deepEqual(
  replica.getDocument().blocks.map(({ text }) => text),
  history.blockTexts,
);

const blockTexts = [...history.blockTexts];
let parent = history.lastEventId;
let rawLength = history.rawLength;
let remoteSequence = 0;

/** Type one character at the end of the last block, as the local user. */
const editLocally = (): number => {
  const offset = blockTexts.at(-1)!.length;
  const start = performance.now();
  const batch = replica.transact((transaction) => {
    transaction.insertText(history.lastBlockId, offset, "x");
  });
  const elapsed = performance.now() - start;
  assert.ok(batch !== null);
  parent = batch.events.at(-1)!.id;
  blockTexts[blockTexts.length - 1] += "x";
  rawLength++;
  return elapsed;
};

/**
 * Type one character the way the Lexical binding commits it: replace the
 * whole document with a copy whose last block gained the character.
 */
const editByReplacingDocument = (): number => {
  const { blocks } = replica.getDocument();
  const next = {
    blocks: blocks.map((block, index) => ({
      id: block.id,
      type: block.type,
      text: index === blocks.length - 1 ? `${block.text}z` : block.text,
      attrs: block.attrs,
      marks: block.marks,
    })),
  };
  const start = performance.now();
  const batch = replica.transact((transaction) => {
    transaction.replaceDocument(next);
  });
  const elapsed = performance.now() - start;
  assert.ok(batch !== null);
  assert.equal(batch.events.length, 1);
  parent = batch.events.at(-1)!.id;
  blockTexts[blockTexts.length - 1] += "z";
  rawLength++;
  return elapsed;
};

/** Receive one character a caught-up peer typed at the same place. */
const editRemotely = (): number => {
  const eventId = `peer:${remoteSequence++}`;
  const batch = buildRemoteTypingBatch(
    model,
    eventId,
    parent,
    rawLength,
    history.lastBlockId,
    "y",
  );
  const start = performance.now();
  const result = replica.applyRemoteEvents(batch);
  const elapsed = performance.now() - start;
  assert.deepEqual(result.integratedBatchIds, [eventId]);
  parent = eventId;
  blockTexts[blockTexts.length - 1] += "y";
  rawLength++;
  return elapsed;
};

for (let edit = 0; edit < WARMUP_EDITS; edit++) {
  editLocally();
  editRemotely();
  editByReplacingDocument();
}
globalThis.gc?.();
const local: number[] = [];
const remote: number[] = [];
const replace: number[] = [];
for (let sample = 0; sample < samples; sample++) {
  local.push(editLocally());
  remote.push(editRemotely());
  replace.push(editByReplacingDocument());
}
assert.deepEqual(
  replica.getDocument().blocks.map(({ text }) => text),
  blockTexts,
);

// Split the last block at its end and join the new block back. The text stays
// the same, but every later mark now has a block join in its causal past.
const joinBatch = replica.transact((transaction) => {
  transaction.joinBlock(
    transaction.splitBlock(history.lastBlockId, blockTexts.at(-1)!.length),
  );
});
assert.ok(joinBatch !== null);
let bold = false;

/** Toggle bold on the last character of the last block. */
const toggleMark = (): number => {
  const length = blockTexts.at(-1)!.length;
  bold = !bold;
  const start = performance.now();
  const batch = replica.transact((transaction) => {
    transaction.setMark(
      history.lastBlockId,
      length - 1,
      length,
      "bold",
      bold ? true : null,
    );
  });
  const elapsed = performance.now() - start;
  assert.ok(batch !== null);
  assert.equal(batch.events.length, 1);
  return elapsed;
};

for (let edit = 0; edit < WARMUP_EDITS; edit++) {
  toggleMark();
}
globalThis.gc?.();
const mark: number[] = [];
for (let sample = 0; sample < samples; sample++) {
  mark.push(toggleMark());
}
const lastLength = blockTexts.at(-1)!.length;
const { blocks } = replica.getDocument();
assert.deepEqual(
  blocks.map(({ text }) => text),
  blockTexts,
);
assert.deepEqual(
  blocks.at(-1)!.marks,
  bold
    ? [{ kind: "bold", from: lastLength - 1, to: lastLength, value: true }]
    : [],
);

console.log(
  JSON.stringify({
    batches: batchCount,
    paragraphLength,
    samples,
    setupMs,
    localMedianMs: median(local),
    remoteMedianMs: median(remote),
    replaceMedianMs: median(replace),
    markMedianMs: median(mark),
    localMs: local,
    remoteMs: remote,
    replaceMs: replace,
    markMs: mark,
    blocks: blockTexts.length,
    finalTextValidated: true,
    maxRssKiB: process.resourceUsage().maxRSS,
  }),
);
