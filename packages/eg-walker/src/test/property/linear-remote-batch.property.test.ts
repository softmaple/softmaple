import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { OPERATION_TYPE } from "../../constants/operation-types";
import { createCausalEventBatchBuilder } from "../../core/causal-event-batch";
import { EgWalkerReplica } from "../../core/replica";
import type { GraphEvent } from "../../types";
import { cloneEvent } from "../test-helpers";
import { fcParams } from "./run-config";

/** One edit, resolved against the text it applies to. */
interface EditStep {
  readonly insert: boolean;
  /** Position as a fraction of the code-point boundaries. */
  readonly at: number;
  readonly text: string;
  readonly length: number;
}

const stepArb: fc.Arbitrary<EditStep> = fc.record({
  insert: fc.boolean(),
  at: fc.double({ min: 0, max: 1, noNaN: true }),
  text: fc.constantFrom("", "a", "bc", "🙂", "é", "xyz"),
  length: fc.integer({ min: 0, max: 3 }),
});

/** UTF-16 offsets that do not split a surrogate pair. */
const boundaries = (text: string): number[] => {
  const result = [0];
  let offset = 0;
  for (const character of text) {
    offset += character.length;
    result.push(offset);
  }
  return result;
};

/** Turn edit steps into one exact chain of valid remote events. */
const chainFromSteps = (
  steps: ReadonlyArray<EditStep>,
  replicaId: string,
  initialText: string,
): { readonly events: GraphEvent[]; readonly text: string } => {
  let text = initialText;
  let parent: string | null = null;
  const events: GraphEvent[] = [];
  for (const [sequence, step] of steps.entries()) {
    const points = boundaries(text);
    const pick = Math.min(
      points.length - 1,
      Math.floor(step.at * points.length),
    );
    const index = points[pick]!;
    const id = `${replicaId}:${sequence}`;
    const parentVersion = new Set(parent === null ? [] : [parent]);
    if (step.insert || pick === points.length - 1) {
      events.push({
        id,
        parentVersion,
        operation: { type: OPERATION_TYPE.INSERT, index, text: step.text },
        timestamp: sequence,
      });
      text = text.slice(0, index) + step.text + text.slice(index);
    } else {
      const end = points[Math.min(points.length - 1, pick + step.length)]!;
      events.push({
        id,
        parentVersion,
        operation: { type: OPERATION_TYPE.DELETE, index, length: end - index },
        timestamp: sequence,
      });
      text = text.slice(0, index) + text.slice(end);
    }
    parent = id;
  }
  return { events, text };
};

/** Split `events` into consecutive batches at the given cut points. */
const splitAt = <T>(
  events: ReadonlyArray<T>,
  cuts: ReadonlyArray<number>,
): T[][] => {
  const positions = [...new Set(cuts.map((cut) => cut % (events.length + 1)))]
    .filter((cut) => cut > 0 && cut < events.length)
    .sort((left, right) => left - right);
  const batches: T[][] = [];
  let start = 0;
  for (const cut of [...positions, events.length]) {
    batches.push(events.slice(start, cut));
    start = cut;
  }
  return batches;
};

const scenarioArb = fc.record({
  steps: fc.array(stepArb, { minLength: 1, maxLength: 120 }),
  cuts: fc.array(fc.nat({ max: 200 }), { maxLength: 6 }),
  initialText: fc.constantFrom("", "seed", "🙂x"),
  seedWithSingleEvent: fc.boolean(),
  concurrentAt: fc.nat(),
});

describe("property: exact-chain batches", () => {
  it("match single-event delivery in results, text and graph", () => {
    fc.assert(
      fc.property(scenarioArb, (scenario) => {
        const { events, text } = chainFromSteps(
          scenario.steps,
          "author",
          scenario.initialText,
        );
        const reference = new EgWalkerReplica(
          "reference",
          scenario.initialText,
        );
        const expected = events.map((event) =>
          reference.applyRemoteEvent(cloneEvent(event)),
        );
        const subject = new EgWalkerReplica("subject", scenario.initialText);
        let remaining = events;
        const results: unknown[] = [];
        if (scenario.seedWithSingleEvent) {
          // An object-tail event first: later batches take the tail path.
          results.push(subject.applyRemoteEvent(cloneEvent(events[0]!)));
          remaining = events.slice(1);
        }

        const operations: unknown[] = [];
        for (const batch of splitAt(remaining, scenario.cuts)) {
          const applied = subject.applyRemoteEvents(batch.map(cloneEvent));
          results.push(...applied.results);
          expect(applied.operations).not.toBeNull();
          operations.push(...applied.operations!);
        }

        expect(results).toEqual(expected);
        if (!scenario.seedWithSingleEvent) {
          expect(operations).toEqual(
            expected.flatMap((entry) =>
              "operation" in entry && entry.operation !== null
                ? [entry.operation]
                : [],
            ),
          );
        }
        expect(subject.getText()).toBe(text);
        expect(subject.exportEventGraph()).toEqual(
          reference.exportEventGraph(),
        );
        expect(subject.getFrontier()).toEqual(reference.getFrontier());

        // A concurrent edit replays over the stored chain.
        const parent = events[scenario.concurrentAt % events.length]!.id;
        const concurrent: GraphEvent = {
          id: "peer:0",
          parentVersion: new Set([parent]),
          operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "P" },
          timestamp: 0,
        };
        subject.applyRemoteEvent(cloneEvent(concurrent));
        reference.applyRemoteEvent(cloneEvent(concurrent));
        expect(subject.getText()).toBe(reference.getText());
      }),
      fcParams(),
    );
  });

  it("apply through causal batches to the same text and graph", () => {
    fc.assert(
      fc.property(scenarioArb, (scenario) => {
        const { events, text } = chainFromSteps(
          scenario.steps,
          "author",
          scenario.initialText,
        );
        const subject = new EgWalkerReplica("causal", scenario.initialText);
        for (const batch of splitAt(events, scenario.cuts)) {
          const builder = createCausalEventBatchBuilder(batch.length);
          for (const event of batch) {
            const operation = event.operation;
            if (operation.type === OPERATION_TYPE.INSERT) {
              builder.appendInsert(
                event.id,
                event.parentVersion,
                operation.index,
                operation.text,
                event.timestamp,
              );
            } else {
              builder.appendDelete(
                event.id,
                event.parentVersion,
                operation.index,
                operation.length,
                event.timestamp,
              );
            }
          }
          subject.applyCausalBatch(builder.finish());
        }
        const reference = new EgWalkerReplica(
          "reference",
          scenario.initialText,
        );
        for (const event of events) {
          reference.applyRemoteEvent(cloneEvent(event));
        }

        expect(subject.getText()).toBe(text);
        expect(subject.exportEventGraph()).toEqual(
          reference.exportEventGraph(),
        );
        const snapshot = EgWalkerReplica.fromPortableSnapshot(
          subject.createPortableSnapshot(),
        );
        snapshot.insert(0, "!");
        expect(snapshot.getText()).toBe(`!${text}`);
      }),
      fcParams(),
    );
  });
});
