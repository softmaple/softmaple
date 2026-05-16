/**
 * Bench: two replicas diverge from a root for `depth` events each, then
 * merge at a single fan-in event. Exercises the partial-replay path
 * (`engine/partial-replay.ts`) and checkpoint selection
 * (`core/internals/critical-checkpoint-store.ts`) on the merge.
 */

import { afterAll, bench, describe } from "vitest";

import { EgWalkerReplica } from "../core/replica";
import {
  buildLongOfflineBranchMerge,
  formatStatsLine,
  summariseReplica,
} from "./traces";

const BRANCH_DEPTH = 1_000;
const events = buildLongOfflineBranchMerge(BRANCH_DEPTH);

let lastReplica: EgWalkerReplica | null = null;

describe("long-offline-branch-merge", () => {
  bench(`apply 2 branches of ${BRANCH_DEPTH} events each, then merge`, () => {
    const replica = new EgWalkerReplica("bench:long-offline-branch-merge");
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
          "long-offline-branch-merge",
          events.length,
          lastReplica,
        ),
      ),
    );
  }
});
