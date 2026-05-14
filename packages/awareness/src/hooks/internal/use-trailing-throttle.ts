/**
 * Internal helper: leading + trailing edge throttle for high-frequency
 * presence updates (cursor, selection). Not exported from the package.
 *
 * Behaviour:
 * - First call inside an idle window invokes `sink` synchronously.
 * - Subsequent calls inside the same `throttleMs` window only schedule a
 *   single trailing call carrying the most recent value.
 * - Passing `throttleMs <= 0` bypasses throttling entirely.
 * - Pending trailing calls are cancelled on unmount.
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

  useEffect(
    () => () => {
      if (trailingTimerRef.current !== null) {
        clearTimeout(trailingTimerRef.current);
        trailingTimerRef.current = null;
      }
    },
    [],
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
