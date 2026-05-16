/**
 * Bench: concurrent same-index inserts.
 *
 * `count` independent inserts at index 0, each from a distinct replica
 * with no shared parent. Stresses YATA origin-left tie-breaking
 * (`engine/internals/yata-integration.ts`) because every event is
 * concurrent with every other event.
 */

import { afterAll, bench, describe } from "vitest";

import { EgWalkerReplica } from "../core/replica";
import {
  buildConcurrentSameIndexInserts,
  formatStatsLine,
  summariseReplica,
} from "./traces";

const EVENT_COUNT = 200;
const events = buildConcurrentSameIndexInserts(EVENT_COUNT);

let lastReplica: EgWalkerReplica | null = null;

describe("concurrent-same-index-inserts", () => {
  bench(`apply ${EVENT_COUNT} concurrent inserts at index 0`, () => {
    const replica = new EgWalkerReplica("bench:concurrent-same-index");
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
        summariseReplica(
          "concurrent-same-index-inserts",
          events.length,
          lastReplica,
        ),
      ),
    );
  }
});
