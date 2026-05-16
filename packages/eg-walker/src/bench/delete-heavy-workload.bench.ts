/**
 * Bench: delete-heavy workload.
 *
 * ~70% of operations after the warm-up are deletes targeting
 * previously-inserted characters. Stresses
 * `engine/internals/delete-target-index.ts` and prepare-visible filtering
 * in the engine.
 */

import { afterAll, bench, describe } from "vitest";

import { EgWalkerReplica } from "../core/replica";
import {
  buildDeleteHeavyWorkload,
  formatStatsLine,
  summariseReplica,
} from "./traces";

const EVENT_COUNT = 2_000;
const events = buildDeleteHeavyWorkload(EVENT_COUNT);

let lastReplica: EgWalkerReplica | null = null;

describe("delete-heavy-workload", () => {
  bench(`apply ${EVENT_COUNT} delete-heavy events (~70% deletes)`, () => {
    const replica = new EgWalkerReplica("bench:delete-heavy");
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
        summariseReplica("delete-heavy-workload", events.length, lastReplica),
      ),
    );
  }
});
