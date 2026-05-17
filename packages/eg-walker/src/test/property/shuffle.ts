/**
 * Fisher–Yates shuffle keyed on a 32-bit seed.
 *
 * Used by the property tests to derive a reproducible delivery
 * permutation from a fast-check-shrunk `seed: number`. The shrunk seed
 * plus the upstream trace arbitrary are sufficient to reproduce any
 * failing case without pulling in additional state.
 *
 * Constants `MULTIPLIER` and `INCREMENT` are Numerical Recipes' LCG
 * parameters (same pair used by `createPrng` in `../test-helpers.ts`).
 * Combined with the `>>> 0` mask and the `/ 2^32` normalisation, the
 * generator produces a uniform `[0, 1)` stream with full 32-bit
 * resolution.
 */
const MULTIPLIER = 1_664_525;
const INCREMENT = 1_013_904_223;

export const shuffleWithSeed = <T>(
  items: ReadonlyArray<T>,
  seed: number,
): T[] => {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state * MULTIPLIER + INCREMENT) >>> 0;
    return state / 0x1_0000_0000;
  };
  const result = items.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    const tmp = result[i]!;
    result[i] = result[j]!;
    result[j] = tmp;
  }
  return result;
};
