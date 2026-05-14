/**
 * Internal helper: leading + trailing edge throttle for high-frequency
 * presence updates (cursor, selection). Not exported from the package.
 *
 * Behaviour:
 * - First call inside an idle window invokes `sink` synchronously.
 * - Subsequent calls inside the same `throttleMs` window only schedule a
 *   single trailing call carrying the most recent value.
 * - Passing `throttleMs <= 0` bypasses throttling entirely.
 * - Pending trailing calls are cancelled on unmount AND when `throttleMs`
 *   changes — otherwise a queued trailing call from the old window would
 *   fire under the new semantics (e.g. throttleMs flipped 50 → 0 should
 *   not still emit a "stale" trailing send).
 */

import { useCallback, useEffect, useRef } from "react";

export const useTrailingEdgeThrottle = <T>(
  sink: (value: T) => void,
  throttleMs: number,
): ((value: T) => void) => {
  const lastSentAtRef = useRef(0);
  const trailingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const trailingValueRef = useRef<T | undefined>(undefined);
  const sinkRef = useRef(sink);
  sinkRef.current = sink;

  // Clear any pending trailing call when the throttle window changes or the
  // hook unmounts. Without this, a 50 → 0 prop change would still fire a
  // queued trailing send despite the consumer opting out of throttling.
  // biome-ignore lint/correctness/useExhaustiveDependencies: throttleMs is intentionally listed even though the effect body doesn't read it — the cleanup must fire on every throttleMs change to drop stale pending timers.
  useEffect(
    () => () => {
      if (trailingTimerRef.current !== null) {
        clearTimeout(trailingTimerRef.current);
        trailingTimerRef.current = null;
        trailingValueRef.current = undefined;
      }
    },
    [throttleMs],
  );

  return useCallback(
    (value: T) => {
      if (throttleMs <= 0) {
        sinkRef.current(value);
        return;
      }

      const now = Date.now();
      const elapsed = now - lastSentAtRef.current;

      if (elapsed >= throttleMs) {
        lastSentAtRef.current = now;
        if (trailingTimerRef.current !== null) {
          clearTimeout(trailingTimerRef.current);
          trailingTimerRef.current = null;
        }
        sinkRef.current(value);
        return;
      }

      trailingValueRef.current = value;
      if (trailingTimerRef.current === null) {
        trailingTimerRef.current = setTimeout(() => {
          trailingTimerRef.current = null;
          lastSentAtRef.current = Date.now();
          // Non-null assertion safe: the value was just written above.
          sinkRef.current(trailingValueRef.current as T);
        }, throttleMs - elapsed);
      }
    },
    [throttleMs],
  );
};
