/**
 * Shared `fast-check` arbitraries for the property-test suite.
 *
 * Layout:
 *
 *   - `replicaIdArb`       — small pool so traces have realistic concurrent
 *                            branching across a handful of authors.
 *   - `bmpTextArb`         — ASCII-biased insert text. Avoids surrogate
 *                            edge cases so unrelated properties are not
 *                            tripped by Unicode well-formedness checks.
 *   - `surrogateBiasedTextArb` — emits paired surrogates frequently for
 *                            the unicode-surrogate property test.
 *   - `localEditScriptArb` — sequence of insert/delete *instructions*
 *                            parameterised by offset/length seeds. The
 *                            trace runner resolves seeds against the
 *                            replica's live text length so generated
 *                            scripts always stay in bounds.
 *   - `traceParamsArb`     — the inputs to the trace runner. Keeping the
 *                            arbitrary as plain data (not as a generated
 *                            `GraphEvent[]`) means fast-check shrinks
 *                            scripts directly instead of opaque events.
 *   - `eventDagArb`        — explicit small DAGs of `GraphEvent`s for
 *                            the missing-parent-buffering test.
 */

import fc from "fast-check";

import { OPERATION_TYPE } from "../../constants/operation-types";
import type { EventId, GraphEvent } from "../../types";

export const REPLICA_IDS: ReadonlyArray<string> = [
  "alice",
  "bob",
  "carol",
  "dave",
];

export const replicaIdArb: fc.Arbitrary<string> = fc.constantFrom(
  ...REPLICA_IDS,
);

const SAFE_BMP_CODE_POINT = fc.oneof(
  { weight: 8, arbitrary: fc.integer({ min: 0x20, max: 0x7e }) },
  { weight: 1, arbitrary: fc.integer({ min: 0xa1, max: 0xd7ff }) },
  { weight: 1, arbitrary: fc.integer({ min: 0xe000, max: 0xfffd }) },
);

const SURROGATE_BIASED_CODE_POINT = fc.oneof(
  { weight: 3, arbitrary: fc.integer({ min: 0x20, max: 0x7e }) },
  { weight: 1, arbitrary: fc.integer({ min: 0xa1, max: 0xd7ff }) },
  { weight: 1, arbitrary: fc.integer({ min: 0xe000, max: 0xfffd }) },
  // Drives the engine through paired-surrogate inserts/deletes.
  { weight: 4, arbitrary: fc.integer({ min: 0x10000, max: 0x10ffff }) },
);

const codePointsToString = (codePoints: ReadonlyArray<number>): string =>
  codePoints.map((cp) => String.fromCodePoint(cp)).join("");

export const bmpTextArb = (
  opts: { readonly minLength?: number; readonly maxLength?: number } = {},
): fc.Arbitrary<string> =>
  fc
    .array(SAFE_BMP_CODE_POINT, {
      minLength: opts.minLength ?? 1,
      maxLength: opts.maxLength ?? 4,
    })
    .map(codePointsToString);

export const surrogateBiasedTextArb = (
  opts: { readonly minLength?: number; readonly maxLength?: number } = {},
): fc.Arbitrary<string> =>
  fc
    .array(SURROGATE_BIASED_CODE_POINT, {
      minLength: opts.minLength ?? 1,
      maxLength: opts.maxLength ?? 3,
    })
    .map(codePointsToString);

export const SEED_TEXTS: ReadonlyArray<string> = [
  "",
  "the quick brown fox",
  "Hello, world!",
  "𝐀𝐁𝐂", // mathematical bold A/B/C — every char is a surrogate pair
];

/**
 * One local edit before its position seeds are resolved.
 *
 * `offsetSeed` and `lengthSeed` are normalised to `[0, 1)` so they can be
 * shrunk independently of the document length they will eventually be
 * mapped onto. The trace runner multiplies them by the replica's live
 * text length to pick an in-bounds index.
 */
export type EditInstruction =
  | {
      readonly kind: "insert";
      readonly offsetSeed: number;
      readonly text: string;
    }
  | {
      readonly kind: "delete";
      readonly offsetSeed: number;
      readonly lengthSeed: number;
    };

const editInstructionArb = (
  textArb: fc.Arbitrary<string>,
  deleteWeight: number,
): fc.Arbitrary<EditInstruction> =>
  fc.oneof(
    {
      weight: 10 - deleteWeight,
      arbitrary: fc.record({
        kind: fc.constant("insert" as const),
        offsetSeed: fc.double({ min: 0, max: 1, noNaN: true }),
        text: textArb,
      }),
    },
    {
      weight: deleteWeight,
      arbitrary: fc.record({
        kind: fc.constant("delete" as const),
        offsetSeed: fc.double({ min: 0, max: 1, noNaN: true }),
        lengthSeed: fc.double({ min: 0, max: 1, noNaN: true }),
      }),
    },
  );

export const localEditScriptArb = (opts: {
  readonly minSteps: number;
  readonly maxSteps: number;
  readonly textArb: fc.Arbitrary<string>;
  /** Weight in `[0, 10]` for delete vs insert. Higher = more deletes. */
  readonly deleteWeight?: number;
}): fc.Arbitrary<ReadonlyArray<EditInstruction>> =>
  fc.array(editInstructionArb(opts.textArb, opts.deleteWeight ?? 3), {
    minLength: opts.minSteps,
    maxLength: opts.maxSteps,
  });

/**
 * Parameters for the multi-replica trace runner. The runner is the
 * separate `./trace-runner.ts` module so the property body can call it
 * with deterministic inputs.
 */
export interface TraceParams {
  readonly initialText: string;
  readonly scripts: ReadonlyArray<{
    readonly replicaId: string;
    readonly edits: ReadonlyArray<EditInstruction>;
  }>;
  readonly syncEveryN: number;
}

export const traceParamsArb = (opts: {
  readonly minReplicas?: number;
  readonly maxReplicas?: number;
  readonly minStepsPerReplica?: number;
  readonly maxStepsPerReplica?: number;
  readonly textArb?: fc.Arbitrary<string>;
  readonly seedTextArb?: fc.Arbitrary<string>;
  readonly syncEveryNArb?: fc.Arbitrary<number>;
  readonly deleteWeight?: number;
}): fc.Arbitrary<TraceParams> => {
  const textArb = opts.textArb ?? bmpTextArb();
  const seedTextArb = opts.seedTextArb ?? fc.constantFrom(...SEED_TEXTS);
  const syncEveryNArb = opts.syncEveryNArb ?? fc.integer({ min: 1, max: 7 });
  const minReplicas = opts.minReplicas ?? 2;
  const maxReplicas = opts.maxReplicas ?? 4;
  const minSteps = opts.minStepsPerReplica ?? 2;
  const maxSteps = opts.maxStepsPerReplica ?? 8;
  return fc
    .tuple(
      fc.uniqueArray(replicaIdArb, {
        minLength: minReplicas,
        maxLength: maxReplicas,
      }),
      seedTextArb,
      syncEveryNArb,
    )
    .chain(([replicaIds, initialText, syncEveryN]) =>
      fc
        .tuple(
          ...replicaIds.map((replicaId) =>
            localEditScriptArb({
              minSteps,
              maxSteps,
              textArb,
              deleteWeight: opts.deleteWeight,
            }).map((edits) => ({ replicaId, edits })),
          ),
        )
        .map((scripts) => ({
          initialText,
          scripts,
          syncEveryN,
        })),
    );
};

/**
 * Explicit small DAG of `GraphEvent`s, used by tests that need to
 * control delivery order independently of replica-driven scripts.
 *
 * Construction: pick a `size` between `minSize` and `maxSize`. Index 0
 * is the single root (no parents); every non-root index `i` gets 1–2
 * parents drawn uniquely from `[0, i - 1]`. The ≥1 lower bound is what
 * lets `missing-parent-buffering.property.test.ts` assert that a
 * reverse-order delivery actually exercises the `RemoteEventBuffer`
 * flushing path — a disconnected DAG would let every event apply
 * cleanly without ever buffering. Every event is an insert at index 0
 * with a short BMP string, which keeps the generator simple and the
 * prepare state non-empty for downstream events.
 */
export const eventDagArb = (opts: {
  readonly minSize?: number;
  readonly maxSize?: number;
}): fc.Arbitrary<ReadonlyArray<GraphEvent>> => {
  const minSize = opts.minSize ?? 3;
  const maxSize = opts.maxSize ?? 10;
  return fc.integer({ min: minSize, max: maxSize }).chain((size) =>
    fc
      .tuple(
        ...Array.from({ length: size }, (_unused, i) =>
          fc.record({
            text: bmpTextArb({ minLength: 1, maxLength: 3 }),
            timestamp: fc.integer({ min: 0, max: 1_000_000 }),
            parentPicks:
              i === 0
                ? fc.constant<ReadonlyArray<number>>([])
                : fc.uniqueArray(fc.integer({ min: 0, max: i - 1 }), {
                    minLength: 1,
                    maxLength: Math.min(2, i),
                  }),
          }),
        ),
      )
      .map((entries) => {
        const events: GraphEvent[] = [];
        for (let i = 0; i < entries.length; i++) {
          const entry = entries[i]!;
          const parentVersion = new Set<EventId>(
            entry.parentPicks.map((idx) => events[idx]!.id),
          );
          events.push({
            id: `dag${i}:0`,
            parentVersion,
            operation: {
              type: OPERATION_TYPE.INSERT,
              index: 0,
              text: entry.text,
            },
            timestamp: entry.timestamp,
          });
        }
        return events;
      }),
  );
};
