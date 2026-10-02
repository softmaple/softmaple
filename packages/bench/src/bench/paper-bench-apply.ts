import {
  APPLY_REMOTE_EVENT_STATUS,
  type EgWalkerReplica,
  type GraphEvent,
} from "@softmaple/eg-walker";
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

/** Nearest-rank percentiles of the time each receive call took. */
export interface ApplyCallLatency {
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly maxMs: number;
}

/**
 * Summarize per-call receive times, or return `null` for a lane that does
 * not time its calls. Percentiles are nearest-rank: the p95 of 20 calls is
 * the 19th fastest.
 */
export const summarizeApplyCallLatency = (
  callMs: ReadonlyArray<number>,
): ApplyCallLatency | null => {
  if (callMs.length === 0) {
    return null;
  }
  const sorted = [...callMs].sort((left, right) => left - right);
  const nearestRank = (fraction: number): number =>
    sorted[Math.max(0, Math.ceil(fraction * sorted.length) - 1)]!;
  return {
    p50Ms: nearestRank(0.5),
    p95Ms: nearestRank(0.95),
    maxMs: sorted[sorted.length - 1]!,
  };
};

/**
 * Wrap a receiver so each `applyRemoteEvents` call appends its duration to
 * `callMs`.
 */
export const timeApplyRemoteEvents = (
  replica: Pick<EgWalkerReplica, "applyRemoteEvents">,
  callMs: number[],
): Pick<EgWalkerReplica, "applyRemoteEvents"> => ({
  applyRemoteEvents: (events) => {
    const startedAt = performance.now();
    const result = replica.applyRemoteEvents(events);
    callMs.push(performance.now() - startedAt);
    return result;
  },
});

/**
 * Apply a converted paper trace one event at a time, the way a live replica
 * receives a peer's edits. Returns the number of `applyRemoteEvent` calls.
 */
export const applyRemoteEventsOneByOne = (
  replica: Pick<EgWalkerReplica, "applyRemoteEvent">,
  events: ReadonlyArray<GraphEvent>,
): number => {
  for (const [index, event] of events.entries()) {
    const { status } = replica.applyRemoteEvent(event);
    if (status !== APPLY_REMOTE_EVENT_STATUS.Integrated) {
      throw new Error(
        `paper trace event ${index} (${event.id}) was ${status}, not integrated`,
      );
    }
  }
  return events.length;
};
