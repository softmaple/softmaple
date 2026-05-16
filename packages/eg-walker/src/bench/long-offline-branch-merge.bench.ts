/**
 * Bench: two replicas diverge from a root for `depth` events each, then
 * merge at a single fan-in event. The first stale branch event forces the
 * replica to recover from a non-ancestor version, then the rest of the
 * branch and merge measure retreat/advance work over a long offline edit.
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
