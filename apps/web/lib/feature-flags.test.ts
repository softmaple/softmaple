import { describe, expect, it } from "vitest";
import {
  DEFAULT_FEATURE_FLAGS,
  FEATURE_FLAG,
  featureFlagVariable,
  resolveFeatureFlags,
} from "@/lib/feature-flags";

describe("resolveFeatureFlags", () => {
  it("falls back to the reviewed default when a variable is unset", () => {
    expect(resolveFeatureFlags({})).toEqual(DEFAULT_FEATURE_FLAGS);
  });

  it("reads each documented truthy and falsy spelling", () => {
    const variable = featureFlagVariable(FEATURE_FLAG.SharedAttention);
    for (const raw of ["0", "false", "OFF", " no ", "disabled"]) {
      expect(
        resolveFeatureFlags({ [variable]: raw })[FEATURE_FLAG.SharedAttention],
      ).toBe(false);
    }
    for (const raw of ["1", "true", "ON", " yes ", "enabled"]) {
      expect(
        resolveFeatureFlags({ [variable]: raw })[FEATURE_FLAG.SharedAttention],
      ).toBe(true);
    }
  });

  it("keeps flags independent of one another", () => {
    const flags = resolveFeatureFlags({
      [featureFlagVariable(FEATURE_FLAG.FieldView)]: "false",
    });
    expect(flags[FEATURE_FLAG.FieldView]).toBe(false);
    expect(flags[FEATURE_FLAG.Shell]).toBe(true);
    expect(flags[FEATURE_FLAG.DetailedPresence]).toBe(true);
    expect(flags[FEATURE_FLAG.SharedAttention]).toBe(true);
  });

  it("treats an unrecognised value as the default rather than failing", () => {
    const variable = featureFlagVariable(FEATURE_FLAG.Shell);
    expect(
      resolveFeatureFlags({ [variable]: "maybe" })[FEATURE_FLAG.Shell],
    ).toBe(true);
  });

  it("returns a frozen snapshot so callers cannot mutate flags", () => {
    expect(Object.isFrozen(resolveFeatureFlags({}))).toBe(true);
  });
});
