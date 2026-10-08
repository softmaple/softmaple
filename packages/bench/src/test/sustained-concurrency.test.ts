import { describe, expect, it } from "vitest";

import { EgWalkerReplica } from "@softmaple/eg-walker";
import {
  measureSustainedConcurrency,
  SUSTAINED_CONCURRENCY_APPLY,
} from "../bench/sustained-concurrency";

describe("sustained-concurrency typing", () => {
  it("converges to the same text through either API", () => {
    const single = measureSustainedConcurrency(
      { EgWalkerReplica },
      {
        writers: 3,
        events: 600,
        maxDelaySteps: 10,
        apply: SUSTAINED_CONCURRENCY_APPLY.Single,
        warmupEvents: 30,
      },
    );
    const batch = measureSustainedConcurrency(
      { EgWalkerReplica },
      {
        writers: 3,
        events: 600,
        maxDelaySteps: 10,
        apply: SUSTAINED_CONCURRENCY_APPLY.Batch,
        warmupEvents: 0,
      },
    );

    for (const result of [single, batch]) {
      expect(result).toMatchObject({
        writers: 3,
        events: 600,
        maxDelaySteps: 10,
        textLength: 600,
      });
      expect(result.receiveMs).toBeLessThanOrEqual(result.totalMs);
      expect(result.relayReceiveMs).toBeLessThanOrEqual(result.receiveMs);
      expect(result.perEventUs).toBeCloseTo((result.totalMs * 1_000) / 600);
      // Every writer and the relay replay the history once, when the first
      // concurrent edit reaches them.
      expect(result.fullReplays).toBe(4);
    }
    expect(single.apply).toBe("single");
    expect(batch.apply).toBe("batch");
    expect(single.textDigest).toBe(batch.textDigest);
  });

  it("rejects invalid counts and APIs", () => {
    const measure = (options: {
      writers?: number;
      events?: number;
      maxDelaySteps?: number;
      apply?: string;
      warmupEvents?: number;
    }): unknown =>
      measureSustainedConcurrency(
        { EgWalkerReplica },
        {
          writers: options.writers ?? 2,
          events: options.events ?? 10,
          maxDelaySteps: options.maxDelaySteps ?? 4,
          // @ts-expect-error -- an API the harness may not know
          apply: options.apply ?? SUSTAINED_CONCURRENCY_APPLY.Single,
          warmupEvents: options.warmupEvents ?? 0,
        },
      );

    expect(() => measure({ writers: 1 })).toThrow(
      "writer count must be an integer of at least 2",
    );
    expect(() => measure({ events: 0 })).toThrow(
      "event count must be an integer of at least 1",
    );
    expect(() => measure({ maxDelaySteps: 0 })).toThrow(
      "maximum delay must be an integer of at least 1",
    );
    expect(() => measure({ warmupEvents: -1 })).toThrow(
      "warm-up event count must be an integer of at least 0",
    );
    expect(() => measure({ apply: "stream" })).toThrow(
      "unknown apply API stream",
    );
  });
});
