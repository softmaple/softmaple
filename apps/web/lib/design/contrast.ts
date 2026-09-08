/**
 * WCAG relative-luminance contrast, used to hold the palette to its promises.
 *
 * The redesign's action colour is a saturated yellow, which has almost no
 * contrast against a light ground. That is fine for a *fill* and disastrous
 * for text or a focus ring, and the difference is easy to lose in a later
 * refactor — so the rule is asserted rather than remembered.
 */

export type Rgb = readonly [number, number, number];

/** Parse `#rgb` or `#rrggbb`. Throws on anything else: a silent 0 would lie. */
export const parseHex = (hex: string): Rgb => {
  const value = hex.trim().replace(/^#/, "");
  const expanded =
    value.length === 3
      ? value
          .split("")
          .map((character) => character + character)
          .join("")
      : value;
  if (!/^[0-9a-fA-F]{6}$/.test(expanded)) {
    throw new Error(`Not a hex colour: "${hex}"`);
  }
  const channel = (index: number): number =>
    Number.parseInt(expanded.slice(index * 2, index * 2 + 2), 16);
  return [channel(0), channel(1), channel(2)] as const;
};

const linearise = (channel: number): number => {
  const ratio = channel / 255;
  return ratio <= 0.04045
    ? ratio / 12.92
    : Math.pow((ratio + 0.055) / 1.055, 2.4);
};

export const relativeLuminance = ([red, green, blue]: Rgb): number =>
  0.2126 * linearise(red) +
  0.7152 * linearise(green) +
  0.0722 * linearise(blue);

/** Contrast ratio between two colours, from 1 (identical) to 21. */
export const contrastRatio = (a: string, b: string): number => {
  const first = relativeLuminance(parseHex(a));
  const second = relativeLuminance(parseHex(b));
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
};

/** WCAG 2.2 thresholds this palette is held to. */
export const CONTRAST_MINIMUM = {
  /** Body text and any text under 18.66px bold / 24px regular. */
  BodyText: 4.5,
  /** Large text, and non-text indicators such as focus rings and borders. */
  LargeTextOrIndicator: 3,
} as const;
