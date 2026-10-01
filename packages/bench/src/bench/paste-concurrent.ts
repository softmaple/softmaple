/**
 * Merge cost of a paste that shares a replay section with a concurrent edit.
 *
 * Two replicas start from the same typed document. The paster inserts
 * `pasteLength` characters in one insert event while the editor concurrently
 * types one character before it. Each replica then receives the other's
 * event, so on both sides the paste and the keystroke replay in the same
 * nonlinear critical section. The harness times each merge, reads the replay
 * engine's live and peak sequence-record counts, and reports the JS heap and
 * array buffers each merge retains after full collections.
 *
 * Every eg-walker function the measurement calls comes from the
 * implementation passed in, so one harness can measure a base and a head
 * build.
 */
import { performance } from "node:perf_hooks";

import type { EgWalkerReplica, GraphEvent } from "@softmaple/eg-walker";

type EgWalkerModule = typeof import("@softmaple/eg-walker");

export type PasteConcurrentApi = Pick<EgWalkerModule, "EgWalkerReplica">;

export interface PasteConcurrentOptions {
  /** UTF-16 code units in the pasted text. */
  readonly pasteLength: number;
  /** Characters the shared document is typed with before the paste. */
  readonly baseLength: number;
  /** Untimed rounds of the whole scenario before the measured one. */
  readonly warmup: number;
  /** Forces a full collection; `globalThis.gc` under `--expose-gc`. */
  readonly collectGarbage: () => void;
  readonly memoryUsage?: () => Pick<
    NodeJS.MemoryUsage,
    "heapUsed" | "arrayBuffers"
  >;
}

/** One replica's merge of the other replica's concurrent event. */
export interface PasteMergeSide {
  readonly mergeMs: number;
  readonly sequenceRecordCount: number;
  readonly peakSequenceRecordCount: number;
  readonly heapBytes: number;
  readonly arrayBufferBytes: number;
  readonly fullReplays: number;
  readonly partialReplays: number;
}

export interface PasteConcurrentResult {
  readonly pasteLength: number;
  readonly baseLength: number;
  /** The replica that pasted, merging the remote keystroke. */
  readonly paster: PasteMergeSide;
  /** The replica that typed, merging the remote paste. */
  readonly editor: PasteMergeSide;
}

const ALPHABET = "abcdefghijklmnopqrstuvwxyz \n";

const PASTER_ID = "paste-author-0001";
const EDITOR_ID = "remote-editor-0001";
const SEED_ID = "shared-seed-0001";

export const pasteText = (length: number): string => {
  const parts: string[] = [];
  for (let index = 0; index < length; index++) {
    parts.push(ALPHABET[(index * 11) % ALPHABET.length]!);
  }
  return parts.join("");
};

/**
 * Copy an event the way a transport delivers it: the receiving replica gets
 * its own strings instead of sharing the sender's paste text in this process.
 */
const deliver = (event: GraphEvent): GraphEvent => {
  const copy = JSON.parse(
    JSON.stringify({ ...event, parentVersion: [...event.parentVersion] }),
  ) as Omit<GraphEvent, "parentVersion"> & {
    readonly parentVersion: ReadonlyArray<string>;
  };
  return { ...copy, parentVersion: new Set(copy.parentVersion) };
};

const requireEvent = (event: GraphEvent | null, label: string): GraphEvent => {
  if (event === null) {
    throw new Error(`${label} produced no event`);
  }
  return event;
};

interface PasteConcurrentRound {
  readonly paster: PasteMergeSide;
  readonly editor: PasteMergeSide;
}

const runRound = (
  api: PasteConcurrentApi,
  options: Required<
    Pick<PasteConcurrentOptions, "pasteLength" | "baseLength">
  > & {
    readonly settle: () => Pick<
      NodeJS.MemoryUsage,
      "heapUsed" | "arrayBuffers"
    >;
  },
  pasted: string,
): PasteConcurrentRound => {
  const { pasteLength, baseLength, settle } = options;
  const seed: EgWalkerReplica = new api.EgWalkerReplica(SEED_ID);
  const seedEvents: GraphEvent[] = [];
  for (let index = 0; index < baseLength; index++) {
    seedEvents.push(
      requireEvent(
        seed.insert(index, ALPHABET[index % ALPHABET.length]!),
        "seed keystroke",
      ),
    );
  }
  const base = seed.getText();

  const paster: EgWalkerReplica = new api.EgWalkerReplica(PASTER_ID);
  const editor: EgWalkerReplica = new api.EgWalkerReplica(EDITOR_ID);
  paster.applyRemoteEvents(seedEvents.map(deliver));
  editor.applyRemoteEvents(seedEvents.map(deliver));

  const pasteIndex = baseLength >> 1;
  const keystrokeIndex = baseLength >> 2;
  const pasteEvent = requireEvent(paster.insert(pasteIndex, pasted), "paste");
  const keystrokeEvent = requireEvent(
    editor.insert(keystrokeIndex, "x"),
    "keystroke",
  );
  const pasteDelivery = deliver(pasteEvent);
  const keystrokeDelivery = deliver(keystrokeEvent);

  const measure = (
    replica: EgWalkerReplica,
    event: GraphEvent,
  ): PasteMergeSide => {
    const before = settle();
    const started = performance.now();
    replica.applyRemoteEvents([event]);
    const mergeMs = performance.now() - started;
    const after = settle();
    const stats = replica.getReplayStats();
    return {
      mergeMs,
      sequenceRecordCount: stats.sequenceRecordCount,
      peakSequenceRecordCount: stats.peakSequenceRecordCount,
      heapBytes: after.heapUsed - before.heapUsed,
      arrayBufferBytes: after.arrayBuffers - before.arrayBuffers,
      fullReplays: stats.fullReplays,
      partialReplays: stats.partialReplays,
    };
  };

  const pasterSide = measure(paster, keystrokeDelivery);
  const editorSide = measure(editor, pasteDelivery);

  // Validate outside the timers. Both replicas stay live through the second
  // memory sample because they are read here.
  const expected =
    base.slice(0, keystrokeIndex) +
    "x" +
    base.slice(keystrokeIndex, pasteIndex) +
    pasted +
    base.slice(pasteIndex);
  for (const [label, replica] of [
    ["paster", paster],
    ["editor", editor],
  ] as const) {
    const text = replica.getText();
    if (text !== expected) {
      throw new Error(
        `${label} text diverged after merging a ${pasteLength}-character paste (${text.length} vs ${expected.length} code units)`,
      );
    }
  }
  return { paster: pasterSide, editor: editorSide };
};

export const measurePasteConcurrent = (
  api: PasteConcurrentApi,
  options: PasteConcurrentOptions,
): PasteConcurrentResult => {
  const { pasteLength, baseLength, warmup, collectGarbage } = options;
  if (!Number.isSafeInteger(pasteLength) || pasteLength < 2) {
    throw new Error(
      `paste length must be an integer of at least 2, got ${pasteLength}`,
    );
  }
  if (!Number.isSafeInteger(baseLength) || baseLength < 4) {
    throw new Error(
      `base length must be an integer of at least 4, got ${baseLength}`,
    );
  }
  if (!Number.isSafeInteger(warmup) || warmup < 0) {
    throw new Error(
      `warm-up rounds must be a non-negative integer, got ${warmup}`,
    );
  }
  const memoryUsage = options.memoryUsage ?? (() => process.memoryUsage());
  const settle = () => {
    collectGarbage();
    collectGarbage();
    return memoryUsage();
  };
  const pasted = pasteText(pasteLength);

  for (let round = 0; round < warmup; round++) {
    runRound(api, { pasteLength, baseLength, settle }, pasted);
  }
  const measured = runRound(api, { pasteLength, baseLength, settle }, pasted);
  return { pasteLength, baseLength, ...measured };
};
