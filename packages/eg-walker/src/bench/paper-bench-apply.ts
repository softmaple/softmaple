import type { EgWalkerReplica } from "../core/replica";
import type { GraphEvent } from "../types";
import type { PaperBenchmarkApplyBatchEvents } from "./paper-bench-options";

/**
 * Apply a converted paper trace through bounded atomic receive batches.
 * Returns the number of public API calls made so benchmark output can expose
 * the selected ingestion boundary alongside the elapsed time.
 */
export const applyRemoteEventsInBatches = (
  replica: Pick<EgWalkerReplica, "applyRemoteEvents">,
  events: ReadonlyArray<GraphEvent>,
  batchEvents: PaperBenchmarkApplyBatchEvents,
): number => {
  if (
    batchEvents !== "all" &&
    (!Number.isSafeInteger(batchEvents) || batchEvents <= 0)
  ) {
    throw new Error("paper benchmark receive batch size must be positive");
  }
  if (events.length === 0) {
    return 0;
  }

  const batchSize = batchEvents === "all" ? events.length : batchEvents;
  let applyCalls = 0;
  for (let start = 0; start < events.length; start += batchSize) {
    replica.applyRemoteEvents(events.slice(start, start + batchSize));
    applyCalls++;
  }
  return applyCalls;
};
