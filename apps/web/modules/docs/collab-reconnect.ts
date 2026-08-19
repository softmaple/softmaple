/**
 * Reconnect timing for the collaboration WebSocket client.
 *
 * A mass disconnect — Worker deployment, Durable Object restart, upstream
 * outage, flaky network — drops every client at once. Deterministic
 * exponential backoff then makes all of them retry in the same instants, so
 * the herd recreates the pressure that caused the disconnect. Full jitter
 * spreads each retry uniformly across its backoff window instead, which keeps
 * the same worst-case wait while flattening the arrival rate.
 */

/** Backoff window for the first retry. */
export const RECONNECT_BASE_DELAY_MS = 500;

/** Upper bound on the backoff window; reached after five failed attempts. */
export const RECONNECT_MAX_DELAY_MS = 10_000;

/**
 * Minimum spacing between reconnects triggered immediately by a browser
 * signal. `online` fires on every interface flap and `visibilitychange` on
 * every focus change, so without a floor those signals would replace the
 * backoff with a retry per event.
 */
export const RECONNECT_ACCELERATION_INTERVAL_MS = 5_000;

/**
 * Floor for a jittered delay. Full jitter can draw a value close to zero, and
 * a server that rejects connections immediately would turn that into a hot
 * retry loop.
 */
export const RECONNECT_MIN_DELAY_MS = 100;

/**
 * Backoff window for `attempt`: `RECONNECT_BASE_DELAY_MS` doubled per attempt
 * and clamped to `RECONNECT_MAX_DELAY_MS`.
 */
export const getReconnectDelayCap = (attempt: number): number => {
  const exponent = Math.max(0, Math.floor(attempt));
  return Math.min(
    RECONNECT_BASE_DELAY_MS * 2 ** exponent,
    RECONNECT_MAX_DELAY_MS,
  );
};

/**
 * Exponential backoff with full jitter. The delay is drawn uniformly from the
 * attempt's backoff window and clamped to `RECONNECT_MIN_DELAY_MS`, so it
 * always lands in `[RECONNECT_MIN_DELAY_MS, getReconnectDelayCap(attempt)]`.
 *
 * @param attempt Zero-based retry counter for the current socket session.
 * @param random Source of `[0, 1)` randomness; injectable for tests.
 */
export const getReconnectDelay = (
  attempt: number,
  random: () => number = Math.random,
): number =>
  Math.max(RECONNECT_MIN_DELAY_MS, random() * getReconnectDelayCap(attempt));

/**
 * True when the browser reports no connectivity. `navigator.onLine === true`
 * only means an interface exists — never that the collaboration backend is
 * reachable — so this is used to suppress retries that cannot succeed, never
 * to assume a retry will succeed.
 */
export const isBrowserOffline = (): boolean =>
  typeof navigator !== "undefined" && navigator.onLine === false;
