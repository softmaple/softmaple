/**
 * Cold replay of concurrent inserts at one position.
 *
 * `events` replicas each insert one letter at the same position, all
 * concurrent with one another, in one of three shapes:
 *
 * - `root`: parentless inserts at index 0, siblings at the document start;
 * - `after`: a base insert, then inserts at index 1 whose parent is the base,
 *   siblings on the base's right;
 * - `before`: a base insert, then inserts at index 0 whose parent is the
 *   base, siblings on the base's left.
 *
 * Replica IDs ascend with the insert order, so every insert sorts after the
 * earlier ones and a linear integration scan would cross all of them: without
 * an index the replay costs O(n²) probes. The harness encodes the history as
 * EGW4 and decodes it outside the timer, then times the cold replay: a replica
 * built from the decoded graph, and its text. It checks the exact text and
 * reports a digest so a driver can require every build to agree.
 *
 * Every eg-walker function the measurement calls comes from the
 * implementation passed in, so one harness can measure a base and a head
 * build.
 */
import { performance } from "node:perf_hooks";

import type { GraphEvent } from "@softmaple/eg-walker";

import { textDigest } from "./wide-frontier";

type EgWalkerModule = typeof import("@softmaple/eg-walker");
type EgWalkerInternalModule = typeof import("@softmaple/eg-walker/internal");

export type SamePositionApi = Pick<EgWalkerModule, "EgWalkerReplica"> &
  Pick<
    EgWalkerInternalModule,
    "ColumnarEventGraphCodec" | "encodeTopologicallyOrderedEventsBinary"
  >;

/** Where the concurrent inserts land. */
export const SAME_POSITION_SHAPE = {
  /** Parentless inserts at index 0. */
  Root: "root",
  /** Inserts right after one base insert, which is their only parent. */
  After: "after",
  /** Inserts right before one base insert, which is their only parent. */
  Before: "before",
} as const;
export type SamePositionShape =
  (typeof SAME_POSITION_SHAPE)[keyof typeof SAME_POSITION_SHAPE];

export interface SamePositionOptions {
  /** Concurrent inserts at the position. */
  readonly events: number;
  readonly shape: SamePositionShape;
  /**
   * Inserts in one untimed round of the same scenario before the measured
   * one, or 0 for none.
   */
  readonly warmupEvents: number;
}

export interface SamePositionResult {
  readonly events: number;
  readonly shape: SamePositionShape;
  readonly totalMs: number;
  readonly perEventUs: number;
  readonly textLength: number;
  /** FNV-1a digest of the final text, as 8 hex digits. */
  readonly textDigest: string;
  readonly integrationProbes: number;
  readonly fugueRebuilds: number;
  readonly fugueComparisons: number;
  readonly fugueMarkerOperations: number;
  readonly sequenceTreeOperations: number;
}

const ALPHABET = "abcdefghijklmnopqrstuvwxyz";
const BASE_TEXT = "|";
const BASE_ID = "base:0";

/** The letter replica `index` inserts. */
const letterOf = (index: number): string => ALPHABET[index % ALPHABET.length]!;

/** The base insert, then `count` concurrent one-letter inserts. */
export const samePositionEvents = (
  count: number,
  shape: SamePositionShape,
): GraphEvent[] => {
  const base: GraphEvent[] =
    shape === SAME_POSITION_SHAPE.Root
      ? []
      : [
          {
            id: BASE_ID,
            parentVersion: new Set<string>(),
            operation: { type: "insert", index: 0, text: BASE_TEXT },
            timestamp: 0,
          },
        ];
  const parentVersion = shape === SAME_POSITION_SHAPE.Root ? [] : [BASE_ID];
  const index = shape === SAME_POSITION_SHAPE.After ? 1 : 0;
  return [
    ...base,
    ...Array.from({ length: count }, (_, replica) => ({
      id: `peer-${String(replica).padStart(6, "0")}:0`,
      parentVersion: new Set<string>(parentVersion),
      operation: { type: "insert" as const, index, text: letterOf(replica) },
      timestamp: replica + 1,
    })),
  ];
};

/** The converged text: the letters in replica order, around the base. */
export const samePositionText = (
  count: number,
  shape: SamePositionShape,
): string => {
  const letters = Array.from({ length: count }, (_, replica) =>
    letterOf(replica),
  ).join("");
  return shape === SAME_POSITION_SHAPE.Root
    ? letters
    : shape === SAME_POSITION_SHAPE.After
      ? `${BASE_TEXT}${letters}`
      : `${letters}${BASE_TEXT}`;
};

const assertCount = (value: number, minimum: number, label: string): void => {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${label} must be an integer of at least ${minimum}`);
  }
};

const runRound = (
  api: SamePositionApi,
  count: number,
  shape: SamePositionShape,
): SamePositionResult => {
  const events = samePositionEvents(count, shape);
  const { binary } = api.encodeTopologicallyOrderedEventsBinary(events);
  const graph = new api.ColumnarEventGraphCodec().decodeBinary(binary);

  const start = performance.now();
  const replica = new api.EgWalkerReplica("same-position-receiver", "", graph);
  const text = replica.getText();
  const totalMs = performance.now() - start;

  if (text !== samePositionText(count, shape)) {
    throw new Error(
      `${shape} replay of ${count} inserts produced text ${textDigest(text)}, expected ${textDigest(samePositionText(count, shape))}`,
    );
  }
  const stats = replica.getReplayStats();
  return {
    events: count,
    shape,
    totalMs,
    perEventUs: (totalMs * 1_000) / count,
    textLength: text.length,
    textDigest: textDigest(text),
    integrationProbes: stats.integrationProbeCount,
    fugueRebuilds: stats.fugueRebuilds,
    fugueComparisons: stats.fugueComparisons,
    fugueMarkerOperations: stats.fugueMarkerOperations,
    sequenceTreeOperations: stats.sequenceTreeOperations,
  };
};

export const measureSamePosition = (
  api: SamePositionApi,
  options: SamePositionOptions,
): SamePositionResult => {
  assertCount(options.events, 1, "event count");
  assertCount(options.warmupEvents, 0, "warm-up event count");
  if (!Object.values(SAME_POSITION_SHAPE).includes(options.shape)) {
    throw new Error(`unknown shape ${String(options.shape)}`);
  }
  if (options.warmupEvents > 0) {
    runRound(api, options.warmupEvents, options.shape);
  }
  return runRound(api, options.events, options.shape);
};
