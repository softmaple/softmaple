import { describe, expect, it } from "vitest";

import {
  PackedLinearReplay,
  replayPackedLinear,
} from "../core/internals/replay-packed-linear";
import { EgWalkerReplica } from "../core/replica";
import { EgWalkerEngine } from "../engine/eg-walker-engine";
import {
  planPackedCriticalReplaySections,
  planPackedCriticalReplaySectionsSteps,
  type PackedCriticalReplayPlan,
} from "../engine/packed-critical-replay-plan";
import { ColumnarEventGraphCodec } from "../graph/columnar-codec";
import { EventGraph } from "../graph/event-graph";
import { runSteps, type Steps } from "../graph/internals/steps";
import { PersistentUtf16Rope } from "../text/persistent-utf16-rope";
import { createPrng } from "./test-helpers";

const codec = new ColumnarEventGraphCodec();

/** Two authors typing at random positions, merging every 40 events. */
const concurrentReplica = (): EgWalkerReplica => {
  const random = createPrng(972);
  const alice = new EgWalkerReplica("alice");
  const bob = new EgWalkerReplica("bob");
  const type = (replica: EgWalkerReplica) => {
    const length = replica.getText().length;
    return length > 0 && random() < 0.2
      ? replica.delete(Math.floor(random() * length), 1)
      : replica.insert(Math.floor(random() * (length + 1)), "x");
  };
  for (let round = 0; round < 12; round++) {
    const fromAlice = Array.from({ length: 40 }, () => type(alice)!);
    const fromBob = Array.from({ length: 25 }, () => type(bob)!);
    alice.applyRemoteEvents(fromBob);
    bob.applyRemoteEvents(fromAlice);
  }
  return alice;
};

const packed = (replica: EgWalkerReplica): Uint8Array =>
  codec.encodeBinary(EventGraph.fromEvents(replica.exportEventGraph()));

/** Run `steps` one step at a time and count the steps. */
const stepThrough = <T>(steps: Steps<T>): { value: T; steps: number } => {
  let count = 1;
  let step = steps.next();
  while (step.done !== true) {
    count++;
    step = steps.next();
  }
  return { value: step.value, steps: count };
};

const orderOf = (plan: PackedCriticalReplayPlan): string[] =>
  Array.from({ length: plan.eventCount }, (_, index) => plan.eventIdAt(index));

const sectionsOf = (plan: PackedCriticalReplayPlan) =>
  Array.from({ length: plan.sectionCount }, (_, index) => ({
    end: plan.sectionEndAt(index),
    linear: plan.isLinearSection(index),
  }));

describe("stepwise replay primitives", () => {
  it("decode a columnar graph in steps to the graph one call decodes", () => {
    // Arrange
    const bytes = packed(concurrentReplica());

    // Act
    const stepwise = stepThrough(codec.decodeBinarySteps(bytes));
    const atOnce = codec.decodeBinary(bytes);

    // Assert
    expect(stepwise.steps).toBeGreaterThan(5);
    expect(stepwise.value.serialize()).toEqual(atOnce.serialize());
    expect(stepwise.value.getFrontier()).toEqual(atOnce.getFrontier());
  });

  it("plan critical sections in steps of one run as in one call", () => {
    // Arrange
    const graph = codec.decodeBinary(packed(concurrentReplica()));

    // Act
    const stepwise = stepThrough(
      planPackedCriticalReplaySectionsSteps(graph, 1),
    );
    const atOnce = planPackedCriticalReplaySections(graph)!;

    // Assert
    expect(stepwise.steps).toBeGreaterThan(atOnce.runCount);
    expect(stepwise.value).not.toBeNull();
    expect(orderOf(stepwise.value!)).toEqual(orderOf(atOnce));
    expect(sectionsOf(stepwise.value!)).toEqual(sectionsOf(atOnce));
  });

  it.each([
    1, 7, 128,
  ])("replay a packed range in chunks of %i events as in one call", (chunkEvents) => {
    // Arrange
    const replica = concurrentReplica();
    const graph = codec.decodeBinary(packed(replica));
    const plan = planPackedCriticalReplaySections(graph)!;
    const replay = (chunk: number) =>
      new EgWalkerEngine().generatePackedSectionRangeSteps(
        plan,
        0,
        plan.sectionCount,
        graph,
        new Set(),
        PersistentUtf16Rope.from(""),
        chunk,
      );

    // Act
    const chunked = stepThrough(replay(chunkEvents));
    const atOnce = stepThrough(replay(Number.POSITIVE_INFINITY));

    // Assert
    expect(atOnce.steps).toBe(1);
    expect(chunked.steps).toBeGreaterThan(1);
    expect(chunked.value.text).toBe(replica.getText());
    expect(atOnce.value.text).toBe(replica.getText());
    expect(chunked.value.stats).toEqual(atOnce.value.stats);
  });

  it("rejects a packed range chunk smaller than one event", () => {
    // Arrange
    const graph = codec.decodeBinary(packed(concurrentReplica()));
    const plan = planPackedCriticalReplaySections(graph)!;

    // Act
    const replay = () =>
      runSteps(
        new EgWalkerEngine().generatePackedSectionRangeSteps(
          plan,
          0,
          plan.sectionCount,
          graph,
          new Set(),
          PersistentUtf16Rope.from(""),
          0,
        ),
      );

    // Assert
    expect(replay).toThrow(RangeError);
  });

  it.each([
    1, 3, 1_000,
  ])("replay a linear chain in chunks of %i events as in one call", (chunkEvents) => {
    // Arrange
    const random = createPrng(986);
    const author = new EgWalkerReplica("author", "seed");
    for (let index = 0; index < 2_000; index++) {
      // Edit at code point boundaries: the text mixes BMP and astral ones.
      const codePoints = Array.from(author.getText());
      const at = Math.floor(random() * (codePoints.length + 1));
      const offset = codePoints.slice(0, at).join("").length;
      if (random() < 0.2 && at < codePoints.length) {
        author.delete(offset, codePoints[at]!.length);
      } else {
        author.insert(offset, random() < 0.5 ? "🙂" : "x");
      }
    }
    const chain = codec
      .decodeBinary(packed(author))
      .getPackedLinearReplayView()!;
    const seed = PersistentUtf16Rope.from("seed");
    const replay = new PackedLinearReplay(chain, seed, chain.count, 0);

    // Act
    expect(() => replay.finish()).toThrow(/before/);
    while (!replay.done) {
      replay.advance(chunkEvents);
    }

    // Assert
    expect(replay.finish().toString()).toBe(author.getText());
    expect(replayPackedLinear(chain, seed).toString()).toBe(author.getText());
  });
});
