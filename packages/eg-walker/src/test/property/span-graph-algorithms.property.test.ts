/**
 * Property: the span-based graph algorithms give the per-event results.
 *
 * Packed graphs order events, plan critical sections and diff versions over
 * runs of consecutive local versions. Each property builds a random graph of
 * chains that fork and merge anywhere, including from the middle of another
 * chain, and checks the run-based result against the per-event
 * implementation it replaced: the traversals in `reference-packed-traversals`
 * and the per-event ranked diff that graphs with a mutable tail still use.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { OPERATION_TYPE } from "../../constants/operation-types";
import { ColumnarEventGraphCodec } from "../../graph/columnar-codec";
import { encodeTopologicallyOrderedEventsBinary } from "../../graph/columnar-codec/topological-binary-encoder";
import { EventGraph } from "../../graph/event-graph";
import type { PackedEventGraphBase } from "../../graph/internals/packed-event-graph-base";
import type { PackedLocalVersionTransition } from "../../graph/internals/packed-diff-versions";
import { RankedDiffVersionsWorkspace } from "../../graph/internals/ranked-diff-versions";
import type { EventId, GraphEvent } from "../../types";
import { ReferencePackedTraversals } from "../reference-packed-traversals";
import { fcParams } from "./run-config";

const AGENTS = ["a", "b", "c"];

interface ChainSpec {
  readonly agent: number;
  readonly length: number;
  /** Seeds of earlier events the chain's first event descends from. */
  readonly parentSeeds: ReadonlyArray<number>;
}

const chainArb: fc.Arbitrary<ChainSpec> = fc.record({
  agent: fc.nat({ max: AGENTS.length - 1 }),
  length: fc.integer({ min: 1, max: 6 }),
  parentSeeds: fc.uniqueArray(fc.nat(), { maxLength: 3 }),
});

/**
 * Events of chains appended one after another. A chain's first event names
 * up to three earlier events, anywhere in earlier chains, as parents; every
 * later event of the chain has only its predecessor.
 */
const chainDagArb: fc.Arbitrary<ReadonlyArray<GraphEvent>> = fc
  .array(chainArb, { minLength: 1, maxLength: 12 })
  .map((chains) => {
    const events: GraphEvent[] = [];
    const nextSequence = AGENTS.map(() => 0);
    for (const chain of chains) {
      const firstParents = new Set<EventId>();
      if (events.length > 0) {
        for (const seed of chain.parentSeeds) {
          firstParents.add(events[seed % events.length]!.id);
        }
      }
      for (let index = 0; index < chain.length; index++) {
        const agent = AGENTS[chain.agent]!;
        const id = `${agent}:${nextSequence[chain.agent]!++}`;
        events.push({
          id,
          parentVersion:
            index === 0 ? firstParents : new Set([events.at(-1)!.id]),
          operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "x" },
          timestamp: events.length,
        });
      }
    }
    return events;
  });

/** Exclusive branch length above which groups order by longest path. */
const MAX_EXCLUSIVE_BRANCH_SPAN = 1_024;

/**
 * A trunk, then one exclusive branch longer than
 * {@link MAX_EXCLUSIVE_BRANCH_SPAN} beside short sibling chains that fork
 * from the trunk or the long branch, and a chain merging some branch tips.
 * Branch groups holding the long branch order by longest causal path instead
 * of exclusive span; a merge tail counts toward a sibling's path but not its
 * exclusive span, so the two orders differ.
 */
const longBranchDagArb: fc.Arbitrary<ReadonlyArray<GraphEvent>> = fc
  .record({
    trunkLength: fc.integer({ min: 1, max: 4 }),
    longLength: fc.integer({
      min: MAX_EXCLUSIVE_BRANCH_SPAN + 1,
      max: MAX_EXCLUSIVE_BRANCH_SPAN + 40,
    }),
    siblings: fc.array(
      fc.record({
        length: fc.integer({ min: 1, max: 6 }),
        forkSeed: fc.nat(),
        fromLongBranch: fc.boolean(),
      }),
      { minLength: 1, maxLength: 4 },
    ),
    mergeSeeds: fc.uniqueArray(fc.nat(), { minLength: 0, maxLength: 3 }),
    mergeTailLength: fc.integer({ min: 1, max: 8 }),
  })
  .map(({ trunkLength, longLength, siblings, mergeSeeds, mergeTailLength }) => {
    const events: GraphEvent[] = [];
    let sequence = 0;
    const append = (parents: ReadonlyArray<EventId>): EventId => {
      const id = `a:${sequence++}`;
      events.push({
        id,
        parentVersion: new Set(parents),
        operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "x" },
        timestamp: events.length,
      });
      return id;
    };
    const appendChain = (
      parents: ReadonlyArray<EventId>,
      length: number,
    ): EventId[] => {
      const ids = [append(parents)];
      while (ids.length < length) {
        ids.push(append([ids.at(-1)!]));
      }
      return ids;
    };

    const trunk = appendChain([], trunkLength);
    const trunkTip = trunk.at(-1)!;
    const longBranch = appendChain([trunkTip], longLength);
    const tips = [longBranch.at(-1)!];
    for (const sibling of siblings) {
      const forkFrom = sibling.fromLongBranch
        ? longBranch[sibling.forkSeed % longBranch.length]!
        : trunk[sibling.forkSeed % trunk.length]!;
      tips.push(appendChain([forkFrom], sibling.length).at(-1)!);
    }
    const mergeParents = unique(mergeSeeds.map((seed) => seed % tips.length));
    if (mergeParents.length > 1) {
      appendChain(
        mergeParents.map((tip) => tips[tip]!),
        mergeTailLength,
      );
    }
    return events;
  });

/** A decoded EGW4 graph and one repacked from a mutable tail, same order. */
const packedBases = (
  events: ReadonlyArray<GraphEvent>,
): PackedEventGraphBase[] => {
  const decoded = new ColumnarEventGraphCodec().decodeBinary(
    encodeTopologicallyOrderedEventsBinary(events).binary,
  );
  const tail = new EventGraph();
  for (const event of events) {
    tail.addEvent(event);
  }
  return [decoded, tail].map(
    (graph) => graph.getPackedReplayPlanningView() as PackedEventGraphBase,
  );
};

const localVersionsArb = fc.array(fc.nat(), { maxLength: 4 });

describe("property: span-based graph algorithms", () => {
  it("order and plan runs exactly like the per-event traversals", () => {
    fc.assert(fc.property(chainDagArb, assertTraversalsMatch), fcParams());
  });

  it("order branch groups by longest path past the exclusive span limit", () => {
    // Each graph holds over a thousand events; a few dozen cases reach every
    // fork and merge position around the long branch.
    fc.assert(
      fc.property(longBranchDagArb, assertTraversalsMatch),
      fcParams({ numRuns: 40 }),
    );
  });

  it("diff versions exactly like the per-event diff", () => {
    fc.assert(
      fc.property(
        chainDagArb,
        localVersionsArb,
        localVersionsArb,
        fc.nat(),
        (events, leftSeeds, rightSeeds, targetSeed) => {
          for (const base of packedBases(events)) {
            const count = base.count;
            const left = unique(leftSeeds.map((seed) => seed % count));
            const right = unique(rightSeeds.map((seed) => seed % count));
            const idsOf = (lvs: ReadonlyArray<number>): Set<EventId> =>
              new Set(lvs.map((lv) => base.idAt(lv)!));

            // Public ID diff, in its observable Set insertion order.
            const expected = perEventDiff(base, left, right);
            const diff = base.diffVersions(idsOf(left), idsOf(right));
            expect(Array.from(diff.onlyInLeft)).toEqual(
              expected.retreat.map((lv) => base.idAt(lv)),
            );
            expect(Array.from(diff.onlyInRight)).toEqual(
              [...expected.advance].reverse().map((lv) => base.idAt(lv)),
            );

            // Range transition from a version to an event's parents.
            const target = targetSeed % count;
            const parents: number[] = [];
            for (let index = 0; index < base.parentCountAt(target); index++) {
              parents.push(base.parentOffsetAt(target, index)!);
            }
            const expectedTransition = perEventDiff(base, left, parents);
            const transition = base.diffLocalVersionsToParentRanges(
              left,
              target,
            );
            expect(expandRanges(transition)).toEqual(expectedTransition);
            expect(transition.retreatEventCount).toBe(
              expectedTransition.retreat.length,
            );
            expect(transition.advanceEventCount).toBe(
              expectedTransition.advance.length,
            );
            assertMaximalRanges(transition);
          }
        },
      ),
      fcParams(),
    );
  });
});

// Helpers

/** Check every span-based traversal against the per-event reference. */
const assertTraversalsMatch = (events: ReadonlyArray<GraphEvent>): void => {
  for (const base of packedBases(events)) {
    const reference = new ReferencePackedTraversals(base);

    expect(Array.from(base.getTopologicalOrderOffsets())).toEqual(
      Array.from(reference.getTopologicalOrderOffsets()),
    );
    expect(Array.from(base.getBranchPreservingOrderOffsets())).toEqual(
      Array.from(reference.getBranchPreservingOrderOffsets()),
    );
    const layout = base.buildBranchPreservingCriticalReplayLayout();
    const expected = reference.buildBranchPreservingCriticalReplayLayout();
    expect(Array.from(layout.eventOrder)).toEqual(
      Array.from(expected.eventOrder),
    );
    expect(Array.from(layout.rankByOffset)).toEqual(
      Array.from(expected.rankByOffset),
    );
    expect(layout.sectionCount).toBe(expected.sectionCount);
    expect(Array.from(layout.sectionEnds)).toEqual(
      Array.from(expected.sectionEnds),
    );
    expect(Array.from(layout.linearSections)).toEqual(
      Array.from(expected.linearSections),
    );
  }
};

const unique = (values: ReadonlyArray<number>): number[] =>
  Array.from(new Set(values));

/** The per-event heap diff over the packed graph's per-event parents. */
const perEventDiff = (
  base: PackedEventGraphBase,
  left: ReadonlyArray<number>,
  right: ReadonlyArray<number>,
): { retreat: number[]; advance: number[] } =>
  new RankedDiffVersionsWorkspace().diffLocalVersions(left, right, {
    eventCount: () => base.count,
    insertionRankOf: (id) => base.offsetOf(id),
    eventIdAt: (rank) => base.idAt(rank),
    forEachParentRank: (rank, visit) => {
      for (let index = 0; index < base.parentCountAt(rank); index++) {
        visit(base.parentOffsetAt(rank, index)!);
      }
    },
  });

const expandRanges = (
  transition: PackedLocalVersionTransition,
): { retreat: number[]; advance: number[] } => {
  const retreat: number[] = [];
  for (let range = 0; range < transition.retreatRangeCount; range++) {
    const start = transition.retreatStarts[range]!;
    for (let lv = transition.retreatEnds[range]! - 1; lv >= start; lv--) {
      retreat.push(lv);
    }
  }
  const advance: number[] = [];
  for (let range = 0; range < transition.advanceRangeCount; range++) {
    const end = transition.advanceEnds[range]!;
    for (let lv = transition.advanceStarts[range]!; lv < end; lv++) {
      advance.push(lv);
    }
  }
  return { retreat, advance };
};

/** Adjacent ranges never touch: a range ends where the next gap starts. */
const assertMaximalRanges = (
  transition: PackedLocalVersionTransition,
): void => {
  for (let range = 1; range < transition.retreatRangeCount; range++) {
    expect(transition.retreatEnds[range]).toBeLessThan(
      transition.retreatStarts[range - 1]!,
    );
  }
  for (let range = 1; range < transition.advanceRangeCount; range++) {
    expect(transition.advanceStarts[range]).toBeGreaterThan(
      transition.advanceEnds[range - 1]!,
    );
  }
};
