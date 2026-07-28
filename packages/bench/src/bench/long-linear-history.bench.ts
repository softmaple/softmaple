/**
 * Bench: single-author append-only chain.
 *
 * Measures incremental-apply throughput on a trace where every event
 * extends the previous one, exercising the Section 3.4 non-conflicting-run
 * fast path on every event after the first.
 */

import { afterAll, bench, describe } from "vitest";

import { EgWalkerReplica } from "@softmaple/eg-walker";
import {
  buildLongLinearHistory,
  formatStatsLine,
  summariseReplica,
} from "./traces";

const EVENT_COUNT = 5_000;
const events = buildLongLinearHistory(EVENT_COUNT);

let lastReplica: EgWalkerReplica | null = null;

describe("long-linear-history", () => {
  bench(`apply ${EVENT_COUNT} sequential inserts to a fresh replica`, () => {
    const replica = new EgWalkerReplica("bench:long-linear");
    for (const event of events) {
      replica.applyRemoteEvent(event);
    }
    lastReplica = replica;
  });
});

afterAll(() => {
  if (lastReplica) {
    console.info(
      formatStatsLine(
        summariseReplica("long-linear-history", events.length, lastReplica),
      ),
    );
  }
});
