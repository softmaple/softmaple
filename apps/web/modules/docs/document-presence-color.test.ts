import { describe, expect, it } from "vitest";
import {
  CONTRAST_MINIMUM,
  contrastRatio,
  parseHex,
} from "@/lib/design/contrast";
import { PALETTE, type ThemeName } from "@/lib/design/palette";
import {
  COLLABORATOR_PALETTE,
  collaboratorColor,
  documentPresenceColor,
  RESERVED_COLORS,
} from "@/modules/docs/document-presence-color";

const THEMES: ReadonlyArray<ThemeName> = ["light", "dark"];

/** Hue in degrees, for the "no yellow" rule. */
const hue = (hex: string): number => {
  const [red, green, blue] = parseHex(hex).map((channel) => channel / 255) as [
    number,
    number,
    number,
  ];
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  if (max === min) return 0;
  const delta = max - min;
  const raw =
    max === red
      ? ((green - blue) / delta) % 6
      : max === green
        ? (blue - red) / delta + 2
        : (red - green) / delta + 4;
  return (raw * 60 + 360) % 360;
};

describe("collaborator colours", () => {
  it("keeps one account's colour across renders and separates adjacent IDs", () => {
    const first = documentPresenceColor("user-1");
    expect(documentPresenceColor("user-1")).toBe(first);
    expect(documentPresenceColor("user-2")).not.toBe(first);
  });

  it("returns a usable colour for empty and Unicode identities", () => {
    for (const id of ["", "张三", "🌿"]) {
      expect(documentPresenceColor(id)).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("gives the same account the same slot in both themes", () => {
    for (const id of ["user-1", "user-2", "张三"]) {
      const index = COLLABORATOR_PALETTE.light.indexOf(
        collaboratorColor(id, "light"),
      );
      expect(
        COLLABORATOR_PALETTE.dark.indexOf(collaboratorColor(id, "dark")),
      ).toBe(index);
    }
  });

  it("never assigns yellow, which belongs to actions", () => {
    // The yellow band, from greenish-gold to orange-gold. Hue is circular, so
    // this is an exclusion of one arc rather than an upper bound.
    const YELLOW_BAND = { from: 40, to: 75 } as const;
    expect(hue(PALETTE.light.action)).toBeGreaterThanOrEqual(YELLOW_BAND.from);
    expect(hue(PALETTE.light.action)).toBeLessThanOrEqual(YELLOW_BAND.to);

    for (const theme of THEMES) {
      for (const entry of COLLABORATOR_PALETTE[theme]) {
        const value = hue(entry.color);
        expect(
          value >= YELLOW_BAND.from && value <= YELLOW_BAND.to,
          `${entry.color} (hue ${Math.round(value)}) is in the yellow band`,
        ).toBe(false);
      }
    }
  });

  it("never reuses the action colour itself", () => {
    const assigned = THEMES.flatMap((theme) =>
      COLLABORATOR_PALETTE[theme].map((entry) => entry.color.toLowerCase()),
    );
    for (const reserved of RESERVED_COLORS) {
      expect(assigned).not.toContain(reserved.toLowerCase());
    }
  });

  it("stays visible as an indicator on both grounds of its own theme", () => {
    for (const theme of THEMES) {
      for (const entry of COLLABORATOR_PALETTE[theme]) {
        for (const ground of ["surfaceWorkspace", "surfaceDocument"] as const) {
          expect(
            contrastRatio(entry.color, PALETTE[theme][ground]),
            `${entry.color} on ${theme} ${ground}`,
          ).toBeGreaterThanOrEqual(CONTRAST_MINIMUM.LargeTextOrIndicator);
        }
      }
    }
  });

  it("keeps a name label readable on the identity colour", () => {
    for (const theme of THEMES) {
      for (const entry of COLLABORATOR_PALETTE[theme]) {
        expect(
          contrastRatio(entry.onColor, entry.color),
          `label on ${entry.color}`,
        ).toBeGreaterThanOrEqual(CONTRAST_MINIMUM.BodyText);
      }
    }
  });

  it("keeps every identity distinguishable from every other", () => {
    for (const theme of THEMES) {
      const colors = COLLABORATOR_PALETTE[theme].map((entry) => entry.color);
      expect(new Set(colors).size).toBe(colors.length);
    }
  });
});
