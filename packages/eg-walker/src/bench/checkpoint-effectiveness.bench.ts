/**
 * Bench: checkpoint effectiveness.
 *
 * Replays the same trace twice and compares wall-clock between:
 *   - "incremental" — `applyRemoteEvent` per event, the path that uses
 *     `CriticalCheckpointStore` to short-circuit replay work.
 *   - "batch-from-graph" — events are pre-loaded into an `EventGraph` and
 *     the replica's constructor runs a single cold-start `fullReplay`.
 *
 * The pair lets readers compare wall-clock and replay-source mix against
 * each other; the `afterAll` line reports the stats from the incremental
 * path which is where checkpoint reuse actually shows up.
 */

import { afterAll, bench, describe } from "vitest";

import { EgWalkerReplica } from "../core/replica";
import { EventGraph } from "../graph/event-graph";
import {
  buildCheckpointTrace,
  formatStatsLine,
  summariseReplica,
} from "./traces";

const events = buildCheckpointTrace({
  mainEvents: 600,
  forkEveryN: 40,
  forkDepth: 5,
});

let lastIncremental: EgWalkerReplica | null = null;

describe("checkpoint-effectiveness", () => {
  bench("incremental: applyRemoteEvent per event (checkpoint-aware)", () => {
    const replica = new EgWalkerReplica("bench:checkpoint-incremental");
    for (const event of events) {
      replica.applyRemoteEvent(event);
    }
    lastIncremental = replica;
  });

  bench("batch-from-graph: single cold-start fullReplay", () => {
    const graph = EventGraph.fromEvents(
      events.map((event) => ({
        id: event.id,
        operation: { ...event.operation },
        parentVersion: new Set(event.parentVersion),
        timestamp: event.timestamp,
      })),
    );
    // Constructor runs `fullReplay()` once when the prebuilt graph is
    // non-empty, so this measures the cold-start path only.
    new EgWalkerReplica("bench:checkpoint-batch", "", graph);
  });
});

afterAll(() => {
  if (lastIncremental) {
    console.info(
      formatStatsLine(
        summariseReplica(
          "checkpoint-effectiveness",
          events.length,
          lastIncremental,
        ),
      ),
    );
  }
});
