/**
 * Bench: checkpoint effectiveness.
 *
 * The trace (`buildCheckpointTrace`) is a long linear chain followed by
 * concurrent siblings off the tail — a shape that drives
 * `canIncrementallyAdvance` to false on every sibling after the first
 * and forces `partialReplayFromCheckpoint` against the tail checkpoint.
 * `partialReplays ≈ siblingCount - 1` in the stats line is the signal
 * that the checkpoint store is being used; a regression in
 * `CriticalCheckpointStore.pickFor` or in `canIncrementallyAdvance`
 * will show up as either a drop in `partialReplays` or a spike in
 * `fullReplays`.
 *
 * Two benches share the trace:
 *   - "incremental" — `applyRemoteEvent` per event, which is the path
 *     that actually consults the checkpoint store.
 *   - "batch-from-graph" — events are pre-loaded into an `EventGraph`
 *     and the replica's constructor runs a single cold-start
 *     `fullReplay`. This gives a cold-start baseline for the same graph
 *     shape, not a throughput target for the incremental path.
 */

import { afterAll, bench, describe } from "vitest";

import { EgWalkerReplica } from "../core/replica";
import { EventGraph } from "../graph/event-graph";
import {
  buildCheckpointTrace,
  formatStatsLine,
  summariseReplica,
} from "./traces";

// 100 linear events seed the checkpoint store; 20 sibling events off the
// tail force ~19 partial replays from the tail checkpoint. The exact count
// surfaces in `afterAll`'s stats line so a regression in checkpoint
// selection or `canIncrementallyAdvance` is visible.
const events = buildCheckpointTrace({
  linearHistory: 100,
  siblingCount: 20,
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
