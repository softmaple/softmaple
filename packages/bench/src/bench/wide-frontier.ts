/**
 * Receive cost on a wide frontier.
 *
 * `events` replicas each make one insert at index 0 with no parents, so every
 * event is concurrent with every other one and the receiver's frontier grows
 * to `events` events. The harness delivers them to a fresh replica either one
 * `applyRemoteEvent` call at a time or as one `applyRemoteEvents` batch, and
 * times only that. Outside the timer it checks the text's length and letters
 * and that the frontier holds every event, and it reports a digest of the
 * text so a driver can require every build and API to converge on the same
 * document.
 *
 * Every eg-walker function the measurement calls comes from the
 * implementation passed in, so one harness can measure a base and a head
 * build.
 */
import { performance } from "node:perf_hooks";

import type { GraphEvent } from "@softmaple/eg-walker";

type EgWalkerModule = typeof import("@softmaple/eg-walker");

export type WideFrontierApi = Pick<EgWalkerModule, "EgWalkerReplica">;

/** How the events reach the receiving replica. */
export const WIDE_FRONTIER_APPLY = {
  /** One `applyRemoteEvent` call per event. */
  Single: "single",
  /** One `applyRemoteEvents` call with every event. */
  Batch: "batch",
} as const;
export type WideFrontierApply =
  (typeof WIDE_FRONTIER_APPLY)[keyof typeof WIDE_FRONTIER_APPLY];

export interface WideFrontierOptions {
  /** Concurrent root inserts, and so the final frontier width. */
  readonly events: number;
  readonly apply: WideFrontierApply;
  /**
   * Events in one untimed round of the same scenario before the measured
   * one, or 0 for none.
   */
  readonly warmupEvents: number;
}

export interface WideFrontierResult {
  readonly events: number;
  readonly apply: WideFrontierApply;
  readonly totalMs: number;
  readonly perEventUs: number;
  readonly frontierSize: number;
  readonly textLength: number;
  /** FNV-1a digest of the final text, as 8 hex digits. */
  readonly textDigest: string;
  readonly fullReplays: number;
  readonly partialReplays: number;
  readonly incrementalApplies: number;
}

const ALPHABET = "abcdefghijklmnopqrstuvwxyz";

/** The letter replica `index` inserts. */
const letterOf = (index: number): string => ALPHABET[index % ALPHABET.length]!;

/** `count` parentless one-letter inserts at index 0, one per replica. */
export const wideFrontierEvents = (count: number): GraphEvent[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `peer-${String(index).padStart(6, "0")}:0`,
    parentVersion: new Set<string>(),
    operation: { type: "insert", index: 0, text: letterOf(index) },
    timestamp: index,
  }));

/** 32-bit FNV-1a over UTF-16 code units, as 8 hex digits. */
export const textDigest = (text: string): string => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

const assertCount = (value: number, minimum: number, label: string): void => {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${label} must be an integer of at least ${minimum}`);
  }
};

const letterCounts = (text: string): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const letter of text) {
    counts.set(letter, (counts.get(letter) ?? 0) + 1);
  }
  return counts;
};

const expectedLetterCounts = (count: number): Map<string, number> => {
  const counts = new Map<string, number>();
  for (let index = 0; index < count; index++) {
    const letter = letterOf(index);
    counts.set(letter, (counts.get(letter) ?? 0) + 1);
  }
  return counts;
};

const runRound = (
  api: WideFrontierApi,
  count: number,
  apply: WideFrontierApply,
): WideFrontierResult => {
  const events = wideFrontierEvents(count);
  const replica = new api.EgWalkerReplica("wide-frontier-receiver");

  const start = performance.now();
  if (apply === WIDE_FRONTIER_APPLY.Single) {
    for (const event of events) {
      replica.applyRemoteEvent(event);
    }
  } else {
    replica.applyRemoteEvents(events);
  }
  const totalMs = performance.now() - start;

  const text = replica.getText();
  const frontierSize = replica.getFrontier().size;
  if (frontierSize !== count) {
    throw new Error(`frontier holds ${frontierSize} of ${count} events`);
  }
  if (text.length !== count) {
    throw new Error(`text has ${text.length} of ${count} letters`);
  }
  const expected = expectedLetterCounts(count);
  for (const [letter, actual] of letterCounts(text)) {
    if (expected.get(letter) !== actual) {
      throw new Error(`text has ${actual} of letter ${letter}`);
    }
  }
  const stats = replica.getReplayStats();
  return {
    events: count,
    apply,
    totalMs,
    perEventUs: (totalMs * 1_000) / count,
    frontierSize,
    textLength: text.length,
    textDigest: textDigest(text),
    fullReplays: stats.fullReplays,
    partialReplays: stats.partialReplays,
    incrementalApplies: stats.incrementalApplies,
  };
};

export const measureWideFrontier = (
  api: WideFrontierApi,
  options: WideFrontierOptions,
): WideFrontierResult => {
  assertCount(options.events, 1, "event count");
  assertCount(options.warmupEvents, 0, "warm-up event count");
  if (!Object.values(WIDE_FRONTIER_APPLY).includes(options.apply)) {
    throw new Error(`unknown apply API ${String(options.apply)}`);
  }
  if (options.warmupEvents > 0) {
    runRound(api, options.warmupEvents, options.apply);
  }
  return runRound(api, options.events, options.apply);
};
