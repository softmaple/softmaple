import { describe, expect, it } from "vitest";
import { consumePresenceQuota } from "./quota";

describe("consumePresenceQuota", () => {
  it("resets a bounded rate window and rejects its overflow", () => {
    const first = consumePresenceQuota(null, 1_000, 2, 100);
    const second = consumePresenceQuota(first.state, 1_001, 2, 100);
    const rejected = consumePresenceQuota(second.state, 1_002, 2, 100);
    const reset = consumePresenceQuota(rejected.state, 1_100, 2, 100);

    expect([
      first.allowed,
      second.allowed,
      rejected.allowed,
      reset.allowed,
    ]).toEqual([true, true, false, true]);
  });

  it("uses the default 80/10s window when not overridden", () => {
    const result = consumePresenceQuota(null, Date.now());
    expect(result.allowed).toBe(true);
    expect(result.state.count).toBe(1);
  });

  it("keeps a rejected call's state unchanged", () => {
    const first = consumePresenceQuota(null, 0, 1, 100);
    const rejected = consumePresenceQuota(first.state, 50, 1, 100);
    expect(rejected.allowed).toBe(false);
    expect(rejected.state).toBe(first.state);
  });
});
