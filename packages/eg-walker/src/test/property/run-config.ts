/**
 * Shared fast-check configuration for the property-test suite.
 *
 * Paper-conformance runs use at least 1,000 generated cases by default.
 * Override via the
 * `EG_WALKER_PROPERTY_RUNS` env var, e.g.:
 *
 *   EG_WALKER_PROPERTY_RUNS=100 pnpm --filter @softmaple/eg-walker test
 */

import type fc from "fast-check";

const parsed = Number(process.env.EG_WALKER_PROPERTY_RUNS);
export const PROPERTY_RUNS: number =
  Number.isFinite(parsed) && parsed > 0
    ? Math.max(1, Math.floor(parsed))
    : 1_000;

export const fcParams = (
  overrides?: fc.Parameters<unknown>,
): fc.Parameters<unknown> => ({
  numRuns: PROPERTY_RUNS,
  ...overrides,
});
