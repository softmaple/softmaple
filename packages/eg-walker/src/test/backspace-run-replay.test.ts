import { describe, expect, it, vi } from "vitest";

import { OPERATION_TYPE } from "../constants/operation-types";
import { EgWalkerReplica } from "../core/replica";
import { EgWalkerEngine } from "../engine/eg-walker-engine";
import {
  planPackedCriticalReplaySections,
  type PackedCriticalReplayPlan,
} from "../engine/packed-critical-replay-plan";
import { ColumnarEventGraphCodec } from "../graph/columnar-codec";
import { EventGraph } from "../graph/event-graph";
import { TransientUtf16RopeEditor } from "../text/transient-utf16-rope";
import type { EventId, ExternalOperation, GraphEvent } from "../types";

describe("linear replay of backspace runs", () => {
  it.each([
    Number.POSITIVE_INFINITY,
    1,
  ])("should delete a backspace run with one edit, in chunks of %s events", (chunkEvents) => {
    // Arrange: type 300 characters, then backspace over the last 150 of
    // them, a surrogate pair among them.
    const typed = `${"a".repeat(200)}🙂${"b".repeat(99)}`;
    const operations: ExternalOperation[] = [
      ...Array.from(typed).map((character, offset) => ({
        type: OPERATION_TYPE.INSERT,
        index: Array.from(typed).slice(0, offset).join("").length,
        text: character,
      })),
      ...backspaces(typed, 150),
    ];
    const plan = planPackedCriticalReplaySections(
      pack(chain("w", operations)),
    )!;
    const replica = new EgWalkerReplica("reader");
    const remove = vi.spyOn(TransientUtf16RopeEditor.prototype, "delete");

    // Act
    replayCoalesced(replica, plan, chunkEvents);

    // Assert
    expect(replica.getText()).toBe(Array.from(typed).slice(0, 150).join(""));
    expect(remove).toHaveBeenCalledTimes(1);
    remove.mockRestore();
  });

  it("should reject a backspace into a surrogate pair", () => {
    // Arrange: delete the character after a pair, then backspace one code
    // unit, into the pair's second half.
    const plan = planPackedCriticalReplaySections(
      pack(
        chain("w", [
          { type: OPERATION_TYPE.INSERT, index: 0, text: "a🙂x" },
          { type: OPERATION_TYPE.DELETE, index: 3, length: 1 },
          { type: OPERATION_TYPE.DELETE, index: 2, length: 1 },
        ]),
      ),
    )!;
    const replica = new EgWalkerReplica("reader");

    // Act
    const replay = (): void =>
      replayCoalesced(replica, plan, Number.POSITIVE_INFINITY);

    // Assert
    expect(replay).toThrow(/between surrogate halves/);
    expect(replica.getText()).toBe("");
  });

  it("should replay a backspace run in a partial replay's linear section", () => {
    // Arrange: typing with a backspace run 70 to 50 events before its end. A
    // peer diverging 70 events back finds a checkpoint 128 back, so the
    // partial replay applies the run as part of a short linear section.
    const typed = "x".repeat(500);
    const history = chain("w", [
      ...Array.from(typed, (character, index) => ({
        type: OPERATION_TYPE.INSERT,
        index,
        text: character,
      })),
      ...backspaces(typed, 20),
      ...Array.from({ length: 80 }, (_unused, index) => ({
        type: OPERATION_TYPE.INSERT,
        index: 480 + index,
        text: "y",
      })),
    ]);
    const replica = new EgWalkerReplica("reader", "", pack(history));
    const peer = insert("peer:0", ["w:530"], 0, "!");

    // Act
    replica.applyRemoteEvent(peer);

    // Assert
    expect(replica.getReplayStats().partialReplays).toBe(1);
    expect(replica.getText()).toBe(engineText([...history, peer]));
  });
});

// Helpers

interface CoalescedReplayHarness {
  replayCoalescedPackedLinearSectionsSteps(
    plan: PackedCriticalReplayPlan,
    startSection: number,
    endSection: number,
    chunkEvents: number,
  ): Generator<void, void, void>;
}

/** Replay every section of `plan` as one coalesced linear range. */
const replayCoalesced = (
  replica: EgWalkerReplica,
  plan: PackedCriticalReplayPlan,
  chunkEvents: number,
): void => {
  const harness = replica as unknown as CoalescedReplayHarness;
  const steps = harness.replayCoalescedPackedLinearSectionsSteps(
    plan,
    0,
    plan.sectionCount,
    chunkEvents,
  );
  while (steps.next().done !== true) {
    // Each step is one chunk.
  }
};

/** Backspaces over the last `count` code points of `text`, one at a time. */
const backspaces = (text: string, count: number): ExternalOperation[] => {
  const characters = Array.from(text);
  return Array.from({ length: count }, (_unused, index) => {
    const remaining = characters.slice(0, characters.length - index);
    const character = remaining[remaining.length - 1]!;
    return {
      type: OPERATION_TYPE.DELETE,
      index: remaining.join("").length - character.length,
      length: character.length,
    };
  });
};

const insert = (
  id: EventId,
  parents: ReadonlyArray<EventId>,
  index: number,
  text: string,
): GraphEvent => ({
  id,
  operation: { type: OPERATION_TYPE.INSERT, index, text },
  parentVersion: new Set(parents),
  timestamp: 0,
});

/** One author's edits as a causal chain. */
const chain = (
  replicaId: string,
  operations: ReadonlyArray<ExternalOperation>,
): GraphEvent[] =>
  operations.map((operation, index) => ({
    id: `${replicaId}:${index}`,
    operation,
    parentVersion: new Set(index === 0 ? [] : [`${replicaId}:${index - 1}`]),
    timestamp: index,
  }));

const pack = (events: ReadonlyArray<GraphEvent>): EventGraph => {
  const codec = new ColumnarEventGraphCodec();
  return codec.decodeBinary(codec.encodeBinary(EventGraph.fromEvents(events)));
};

/** Text of `events` replayed event by event, without linear coalescing. */
const engineText = (events: ReadonlyArray<GraphEvent>): string => {
  const graph = EventGraph.fromEvents(events);
  const order = graph.getBranchPreservingTopologicalOrder();
  return new EgWalkerEngine()
    .generate(order, "", { eventGraph: graph, eventOrder: order })
    .textBuffer.toString();
};
