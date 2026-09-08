import { describe, expect, it } from "vitest";
import {
  DEFAULT_PREFERENCES,
  MOTION_PREFERENCE,
  parsePreferences,
} from "@/components/shell/preferences";

describe("parsePreferences", () => {
  it("returns the defaults when nothing is stored", () => {
    expect(parsePreferences(null)).toEqual(DEFAULT_PREFERENCES);
  });

  it("returns the defaults for unparseable storage", () => {
    expect(parsePreferences("{not json")).toEqual(DEFAULT_PREFERENCES);
    expect(parsePreferences("null")).toEqual(DEFAULT_PREFERENCES);
    expect(parsePreferences('"a string"')).toEqual(DEFAULT_PREFERENCES);
  });

  it("keeps recognised values and replaces the rest", () => {
    expect(
      parsePreferences(
        JSON.stringify({
          motion: MOTION_PREFERENCE.Reduced,
          focusMode: "yes",
          detailedLocation: false,
        }),
      ),
    ).toEqual({
      motion: MOTION_PREFERENCE.Reduced,
      focusMode: DEFAULT_PREFERENCES.focusMode,
      detailedLocation: false,
    });
  });

  it("rejects an unknown motion value", () => {
    expect(parsePreferences(JSON.stringify({ motion: "wild" })).motion).toBe(
      DEFAULT_PREFERENCES.motion,
    );
  });

  it("defaults detailed location to on, and focus mode to off", () => {
    expect(DEFAULT_PREFERENCES.detailedLocation).toBe(true);
    expect(DEFAULT_PREFERENCES.focusMode).toBe(false);
  });
});
