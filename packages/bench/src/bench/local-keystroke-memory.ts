/**
 * Retained memory per local keystroke.
 *
 * One replica types `count` single-character inserts, either appending at
 * the end or inserting in the middle of the document. The harness forces
 * full collections before and after typing and reports what the live
 * replica retains per keystroke: JS heap plus array buffers (the packed and
 * typed-array columns an event log keeps outside the JS heap).
 *
 * Every eg-walker function the measurement calls comes from the
 * implementation passed in, so one harness can measure a base and a head
 * build.
 */
import { performance } from "node:perf_hooks";

import type { EgWalkerReplica } from "@softmaple/eg-walker";

type EgWalkerModule = typeof import("@softmaple/eg-walker");

export type LocalKeystrokeMemoryApi = Pick<EgWalkerModule, "EgWalkerReplica">;

export const LOCAL_KEYSTROKE_MODES = ["append", "middle"] as const;
export type LocalKeystrokeMode = (typeof LOCAL_KEYSTROKE_MODES)[number];

export interface LocalKeystrokeMemoryOptions {
  readonly count: number;
  readonly mode: LocalKeystrokeMode;
  /** Forces a full collection; `globalThis.gc` under `--expose-gc`. */
  readonly collectGarbage: () => void;
  readonly memoryUsage?: () => Pick<
    NodeJS.MemoryUsage,
    "heapUsed" | "arrayBuffers"
  >;
}

export interface LocalKeystrokeMemoryResult {
  readonly count: number;
  readonly mode: LocalKeystrokeMode;
  readonly typeMs: number;
  readonly heapBytes: number;
  readonly arrayBufferBytes: number;
  readonly heapBytesPerKeystroke: number;
  readonly arrayBufferBytesPerKeystroke: number;
  readonly retainedBytesPerKeystroke: number;
}

const ALPHABET = "abcdefghijklmnopqrstuvwxyz ";

export const parseLocalKeystrokeMode = (value: string): LocalKeystrokeMode => {
  const mode = LOCAL_KEYSTROKE_MODES.find((candidate) => candidate === value);
  if (mode === undefined) {
    throw new Error(
      `keystroke mode must be one of ${LOCAL_KEYSTROKE_MODES.join(", ")}, got ${value}`,
    );
  }
  return mode;
};

export const measureLocalKeystrokeMemory = (
  api: LocalKeystrokeMemoryApi,
  options: LocalKeystrokeMemoryOptions,
): LocalKeystrokeMemoryResult => {
  const { count, mode, collectGarbage } = options;
  if (!Number.isSafeInteger(count) || count < 1) {
    throw new Error(`keystroke count must be a positive integer, got ${count}`);
  }
  const memoryUsage = options.memoryUsage ?? (() => process.memoryUsage());
  const settle = () => {
    collectGarbage();
    collectGarbage();
    return memoryUsage();
  };

  const before = settle();
  const replica: EgWalkerReplica = new api.EgWalkerReplica(
    "keystroke-author-0001",
  );
  const started = performance.now();
  for (let index = 0; index < count; index++) {
    const position = mode === "append" ? index : index >> 1;
    replica.insert(position, ALPHABET[index % ALPHABET.length]!);
  }
  const typeMs = performance.now() - started;
  const after = settle();
  // Read the replica after the second sample so it stays live through it.
  const textLength = replica.getText().length;
  if (textLength !== count) {
    throw new Error(
      `typed ${count} keystrokes but the document has ${textLength} code units`,
    );
  }

  const heapBytes = after.heapUsed - before.heapUsed;
  const arrayBufferBytes = after.arrayBuffers - before.arrayBuffers;
  return {
    count,
    mode,
    typeMs,
    heapBytes,
    arrayBufferBytes,
    heapBytesPerKeystroke: heapBytes / count,
    arrayBufferBytesPerKeystroke: arrayBufferBytes / count,
    retainedBytesPerKeystroke: (heapBytes + arrayBufferBytes) / count,
  };
};
