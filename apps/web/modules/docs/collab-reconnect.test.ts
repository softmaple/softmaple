import { describe, expect, it } from "vitest";
import {
  getReconnectDelay,
  getReconnectDelayCap,
  isBrowserOffline,
  RECONNECT_BASE_DELAY_MS,
  RECONNECT_MAX_DELAY_MS,
  RECONNECT_MIN_DELAY_MS,
} from "./collab-reconnect";

/** Deterministic [0, 1) source so jitter assertions can never flake. */
const createRandomSequence = (seed: number): (() => number) => {
  let state = seed % 2_147_483_647;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_647;
    return state / 2_147_483_647;
  };
};

const ATTEMPTS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 20] as const;

describe("getReconnectDelayCap", () => {
  it("should grow exponentially from the base delay up to the maximum", () => {
    // Arrange / Act
    const caps = [0, 1, 2, 3, 4, 5, 6].map(getReconnectDelayCap);

    // Assert
    expect(caps).toEqual([500, 1_000, 2_000, 4_000, 8_000, 10_000, 10_000]);
    expect(caps[0]).toBe(RECONNECT_BASE_DELAY_MS);
  });

  it("should never exceed the maximum delay for any attempt", () => {
    for (const attempt of [7, 12, 40, 1_024]) {
      expect(getReconnectDelayCap(attempt)).toBe(RECONNECT_MAX_DELAY_MS);
    }
  });

  it("should treat fractional and negative attempts as whole retries", () => {
    expect(getReconnectDelayCap(1.9)).toBe(getReconnectDelayCap(1));
    expect(getReconnectDelayCap(-5)).toBe(RECONNECT_BASE_DELAY_MS);
  });
});

describe("getReconnectDelay", () => {
  it("should keep every jittered delay inside the attempt's window", () => {
    // Arrange
    const random = createRandomSequence(7);

    // Act / Assert
    for (const attempt of ATTEMPTS) {
      for (let draw = 0; draw < 50; draw += 1) {
        const delay = getReconnectDelay(attempt, random);
        expect(delay).toBeGreaterThanOrEqual(RECONNECT_MIN_DELAY_MS);
        expect(delay).toBeLessThanOrEqual(getReconnectDelayCap(attempt));
      }
    }
  });

  it("should map the randomness bounds onto the window bounds", () => {
    // A zero draw is floored instead of retrying immediately, and a draw just
    // below one reaches the top of the window.
    expect(getReconnectDelay(0, () => 0)).toBe(RECONNECT_MIN_DELAY_MS);
    expect(getReconnectDelay(3, () => 0.5)).toBe(2_000);
    expect(getReconnectDelay(3, () => 0.999)).toBeCloseTo(3_996, 5);
    expect(getReconnectDelay(9, () => 0.999)).toBeCloseTo(9_990, 5);
  });

  it("should spread a herd of clients retrying the same attempt", () => {
    // Arrange — one delay per client disconnected by the same outage.
    const random = createRandomSequence(11);

    // Act
    const delays = Array.from({ length: 200 }, () =>
      getReconnectDelay(6, random),
    );

    // Assert — deterministic backoff would put all 200 on the same millisecond.
    expect(new Set(delays).size).toBeGreaterThan(150);
    const mean = delays.reduce((sum, delay) => sum + delay, 0) / delays.length;
    expect(mean).toBeGreaterThan(RECONNECT_MAX_DELAY_MS * 0.35);
    expect(mean).toBeLessThan(RECONNECT_MAX_DELAY_MS * 0.65);
  });

  it("should default to Math.random without an injected source", () => {
    const delay = getReconnectDelay(2);
    expect(delay).toBeGreaterThanOrEqual(RECONNECT_MIN_DELAY_MS);
    expect(delay).toBeLessThanOrEqual(getReconnectDelayCap(2));
  });
});

describe("isBrowserOffline", () => {
  it("should report offline only when the browser says so", () => {
    // Arrange
    const setOnLine = (value: boolean): void => {
      Object.defineProperty(window.navigator, "onLine", {
        configurable: true,
        get: () => value,
      });
    };

    // Act / Assert
    setOnLine(true);
    expect(isBrowserOffline()).toBe(false);
    setOnLine(false);
    expect(isBrowserOffline()).toBe(true);

    Reflect.deleteProperty(window.navigator, "onLine");
  });
});
