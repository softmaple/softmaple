/**
 * Fixed-window rate limiting for the presence WebSocket transport.
 */

export type PresenceRateLimit = {
  readonly count: number;
  readonly windowStartedAt: number;
};

export const consumePresenceQuota = (
  current: PresenceRateLimit | null,
  now: number,
  maximum = 80,
  windowMs = 10_000,
): { readonly allowed: boolean; readonly state: PresenceRateLimit } => {
  if (current === null || now - current.windowStartedAt >= windowMs) {
    return { allowed: true, state: { count: 1, windowStartedAt: now } };
  }
  if (current.count >= maximum) return { allowed: false, state: current };
  return {
    allowed: true,
    state: { ...current, count: current.count + 1 },
  };
};
