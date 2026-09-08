import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CONTRAST_MINIMUM,
  contrastRatio,
  parseHex,
} from "@/lib/design/contrast";
import {
  PALETTE,
  PALETTE_VARIABLES,
  TEXT_GROUNDS,
  type Palette,
  type ThemeName,
} from "@/lib/design/palette";

const THEMES: ReadonlyArray<ThemeName> = ["light", "dark"];

/** Read `--token: #value` pairs out of one selector block of design.css. */
const readTokens = (selector: string): ReadonlyMap<string, string> => {
  const css = readFileSync(
    path.join(import.meta.dirname, "../../app/design.css"),
    "utf8",
  );
  const start = css.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`No ${selector} block in design.css`);
  const block = css.slice(start, css.indexOf("\n}", start));
  return new Map(
    [...block.matchAll(/(--[a-z-]+):\s*(#[0-9a-fA-F]{3,8});/g)].map((match) => [
      match[1] as string,
      (match[2] as string).toLowerCase(),
    ]),
  );
};

describe("palette mirrors the stylesheet", () => {
  it.each([
    ["light", ":root"],
    ["dark", ".dark"],
  ] as const)("%s matches design.css", (theme, selector) => {
    const declared = readTokens(selector);
    for (const [key, variable] of Object.entries(PALETTE_VARIABLES)) {
      expect(declared.get(variable), `${variable} in ${selector}`).toBe(
        PALETTE[theme][key as keyof Palette],
      );
    }
  });
});

describe("readable text", () => {
  it.each(
    THEMES,
  )("%s: content and secondary text pass AA everywhere", (theme) => {
    const palette = PALETTE[theme];
    for (const ground of TEXT_GROUNDS) {
      for (const key of ["content", "contentSecondary"] as const) {
        expect(
          contrastRatio(palette[key], palette[ground]),
          `${key} on ${ground}`,
        ).toBeGreaterThanOrEqual(CONTRAST_MINIMUM.BodyText);
      }
    }
  });

  it.each(THEMES)("%s: links and emphasis pass AA on both grounds", (theme) => {
    const palette = PALETTE[theme];
    for (const ground of ["surfaceWorkspace", "surfaceDocument"] as const) {
      for (const key of ["link", "linkHover", "emphasis"] as const) {
        expect(
          contrastRatio(palette[key], palette[ground]),
          `${key} on ${ground}`,
        ).toBeGreaterThanOrEqual(CONTRAST_MINIMUM.BodyText);
      }
    }
  });

  it.each(THEMES)("%s: text on the action fill passes AA", (theme) => {
    const palette = PALETTE[theme];
    expect(
      contrastRatio(palette.actionContrast, palette.action),
    ).toBeGreaterThanOrEqual(CONTRAST_MINIMUM.BodyText);
    expect(
      contrastRatio(palette.attentionContrast, palette.attentionSurface),
    ).toBeGreaterThanOrEqual(CONTRAST_MINIMUM.BodyText);
  });

  it.each(THEMES)("%s: feedback colours pass AA on both grounds", (theme) => {
    const palette = PALETTE[theme];
    for (const ground of ["surfaceWorkspace", "surfaceDocument"] as const) {
      for (const key of [
        "feedbackPositive",
        "feedbackCaution",
        "feedbackCritical",
      ] as const) {
        expect(
          contrastRatio(palette[key], palette[ground]),
          `${key} on ${ground}`,
        ).toBeGreaterThanOrEqual(CONTRAST_MINIMUM.BodyText);
      }
    }
  });
});

describe("indicators", () => {
  it.each(THEMES)("%s: the focus ring is visible on every ground", (theme) => {
    const palette = PALETTE[theme];
    for (const ground of TEXT_GROUNDS) {
      expect(
        contrastRatio(palette.focus, palette[ground]),
        `focus on ${ground}`,
      ).toBeGreaterThanOrEqual(CONTRAST_MINIMUM.LargeTextOrIndicator);
    }
  });

  it("never uses the action colour for focus", () => {
    for (const theme of THEMES) {
      expect(PALETTE[theme].focus).not.toBe(PALETTE[theme].action);
    }
  });

  it("light action yellow is unusable as text, which is why it is a fill", () => {
    // Documents the constraint the palette is built around: if this ever
    // passes, someone has changed the action colour and the "fill only" rule
    // needs revisiting rather than silently relaxing.
    expect(
      contrastRatio(PALETTE.light.action, PALETTE.light.surfaceWorkspace),
    ).toBeLessThan(CONTRAST_MINIMUM.LargeTextOrIndicator);
  });
});

describe("parseHex", () => {
  it("expands short form and rejects nonsense", () => {
    expect(parseHex("#abc")).toEqual([0xaa, 0xbb, 0xcc]);
    expect(() => parseHex("#xyzxyz")).toThrow(/Not a hex colour/);
  });
});
