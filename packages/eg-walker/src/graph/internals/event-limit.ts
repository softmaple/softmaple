/**
 * Caller limits on the number of events a decoded graph may hold.
 *
 * Runs let a short EGW4 payload declare up to `EGW4_MAX_EVENTS` events, and
 * a decoded graph keeps about 17 bytes per event (21 when indexes exceed 32
 * bits), so callers decoding untrusted bytes pass a lower `maxEvents`.
 */

/** The caller's `maxEvents`, or no limit when it is unset or `Infinity`. */
export const eventLimitOf = (maxEvents: number | undefined): number => {
  if (maxEvents === undefined || maxEvents === Number.POSITIVE_INFINITY) {
    return Number.POSITIVE_INFINITY;
  }
  if (!Number.isInteger(maxEvents) || maxEvents < 0) {
    throw new Error(
      `maxEvents must be a non-negative integer, got ${maxEvents}`,
    );
  }
  return maxEvents;
};

/** Throw when a graph of `count` events exceeds `limit`. */
export const assertWithinEventLimit = (count: number, limit: number): void => {
  if (count > limit) {
    throw new Error(
      `Graph event count ${count} exceeds the limit of ${limit} events`,
    );
  }
};
