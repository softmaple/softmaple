/**
 * Property: after a cold load, merging a peer that diverged at any event of
 * the history gives the same text as replaying the whole history, and so
 * does the peer's next edit.
 *
 * Histories mix long chains with forks that either merge or stay open, so a
 * divergence reaches the checkpoint ladder's cuts with chains, concurrent
 * sections or both between the cut and the divergence.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { OPERATION_TYPE } from "../../constants/operation-types";
import { EgWalkerReplica } from "../../core/replica";
import { ColumnarEventGraphCodec } from "../../graph/columnar-codec";
import { EventGraph } from "../../graph/event-graph";
import type { EventId, GraphEvent } from "../../types";
import { fcParams } from "./run-config";

describe("property: partial replay after a cold load", () => {
  it(
    "should merge a peer that diverged at any event into the replayed text",
    {
      // Each run loads its history cold three times; the suite's default run
      // count needs longer than the default per-test timeout.
      timeout: 60_000,
    },
    () => {
      fc.assert(
        fc.property(
          // Six segments reach past the ladder's 256-event cut while keeping a
          // history at most 1,200 events long, so every run stays cheap.
          fc.array(segmentArb, { minLength: 1, maxLength: 6 }),
          fc.nat(),
          (segments, pick) => {
            // Arrange
            const history = buildHistory(segments);
            const ancestor = history[pick % history.length]!;
            const late = insert("peer:0", [ancestor.id], 0);
            const next = insert("peer:1", ["peer:0"], 1);
            const replica = new EgWalkerReplica("reader", "", pack(history));

            // Act
            replica.applyRemoteEvent(late);
            const afterLate = replica.getText();
            replica.applyRemoteEvent(next);

            // Assert
            expect(afterLate).toBe(replayedText([...history, late]));
            expect(replica.getText()).toBe(
              replayedText([...history, late, next]),
            );
          },
        ),
        fcParams(),
      );
    },
  );
});

// Helpers

type Segment =
  | {
      readonly kind: "chain";
      readonly length: number;
      readonly atEnd: boolean;
    }
  | {
      readonly kind: "fork";
      readonly branches: ReadonlyArray<number>;
      readonly merged: boolean;
      readonly atEnd: boolean;
    };

const segmentArb: fc.Arbitrary<Segment> = fc.oneof(
  fc.record({
    kind: fc.constant("chain" as const),
    length: fc.integer({ min: 1, max: 200 }),
    atEnd: fc.boolean(),
  }),
  fc.record({
    kind: fc.constant("fork" as const),
    branches: fc.array(fc.integer({ min: 1, max: 6 }), {
      minLength: 2,
      maxLength: 3,
    }),
    merged: fc.boolean(),
    atEnd: fc.boolean(),
  }),
);

const insert = (
  id: EventId,
  parents: ReadonlyArray<EventId>,
  index: number,
): GraphEvent => ({
  id,
  operation: { type: OPERATION_TYPE.INSERT, index, text: "x" },
  parentVersion: new Set(parents),
  timestamp: 0,
});

/**
 * Every event inserts one character, so the text an event edits is as long
 * as its parents' closure. Inserting at 0 or at that length is always valid.
 */
const buildHistory = (segments: ReadonlyArray<Segment>): GraphEvent[] => {
  const events: GraphEvent[] = [];
  let tips: EventId[] = [];
  let closureSize = 0;
  const append = (
    parents: ReadonlyArray<EventId>,
    parentClosureSize: number,
    atEnd: boolean,
  ): EventId => {
    const id = `e${events.length}:0`;
    events.push(insert(id, parents, atEnd ? parentClosureSize : 0));
    return id;
  };
  for (const segment of segments) {
    if (segment.kind === "chain") {
      for (let index = 0; index < segment.length; index++) {
        tips = [append(tips, closureSize, segment.atEnd)];
        closureSize++;
      }
      continue;
    }
    const branchTips = segment.branches.map((length) => {
      let tip = append(tips, closureSize, segment.atEnd);
      for (let index = 1; index < length; index++) {
        tip = append([tip], closureSize + index, segment.atEnd);
      }
      return tip;
    });
    closureSize += segment.branches.reduce((sum, length) => sum + length, 0);
    if (segment.merged) {
      tips = [append(branchTips, closureSize, segment.atEnd)];
      closureSize++;
    } else {
      tips = branchTips;
    }
  }
  return events;
};

const pack = (events: ReadonlyArray<GraphEvent>): EventGraph => {
  const codec = new ColumnarEventGraphCodec();
  return codec.decodeBinary(codec.encodeBinary(EventGraph.fromEvents(events)));
};

const replayedText = (events: ReadonlyArray<GraphEvent>): string =>
  new EgWalkerReplica("oracle", "", EventGraph.fromEvents(events)).getText();
