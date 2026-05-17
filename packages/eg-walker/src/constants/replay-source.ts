/**
 * Source of the most recent replay performed by {@link EgWalkerReplica}.
 *
 * Const object with `as const` assertion (no TS enum) so callers see a
 * narrow string-literal union and the value contributes nothing to bundle
 * size beyond the string itself. Exposed via {@link EgWalkerReplica.getReplayStats}
 * so benches and tests can correlate wall-clock measurements with the
 * path that actually handled the last event.
 *
 * - `incremental` — engine state was a causal ancestor of the event's
 *   parent, so only an advance was needed.
 * - `partial` — divergent suffix was rebuilt from a critical-version
 *   checkpoint (Section 3.5/3.6 of the paper).
 * - `full` — no usable checkpoint dominated the divergence, so the entire
 *   event graph was replayed from scratch (also the cold-start path on the
 *   very first event).
 */
export const REPLAY_SOURCE = {
  INCREMENTAL: "incremental",
  PARTIAL: "partial",
  FULL: "full",
} as const;

export type ReplaySource = (typeof REPLAY_SOURCE)[keyof typeof REPLAY_SOURCE];
