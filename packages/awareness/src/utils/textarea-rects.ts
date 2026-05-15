/**
 * Geometry helpers for rendering presence overlays on top of a native
 * `<textarea>`. Consumers (e.g. the playground's `EditorSurface`) used
 * to inline these helpers; the per-line rect computation in particular
 * is generic enough that anyone rendering remote selections over a
 * textarea needs the exact same logic — including the same fractional-
 * line-height footguns. Owning a single implementation in the package
 * means the contract has one set of tests, and the second consumer
 * doesn't reinvent it with subtly different bugs.
 *
 * Both helpers return **textarea content coordinates** — i.e. relative
 * to the textarea's content box, NOT adjusted for the textarea's
 * internal scroll. Consumers have two options for folding scroll in:
 *
 *  - Pass `trackHostScroll` on `<PresenceLayer>` (preferred): the
 *    layer subtracts `host.scrollLeft`/`scrollTop` automatically and
 *    re-renders when the host scrolls. The values returned here can
 *    be handed straight through.
 *  - Subtract `textarea.scrollLeft`/`scrollTop` from `.x`/`.y` at the
 *    call site. Required when the layer isn't tracking host scroll
 *    (e.g. the host doesn't scroll, or the consumer wants caret-
 *    relative coordinates for some other reason).
 */

import type { HighlightRect } from "../components/selection-highlight";

export interface TextareaCaretRect {
  readonly top: number;
  readonly left: number;
  readonly height: number;
}

export interface TextareaSelectionRange {
  readonly from: number;
  readonly to: number;
}

const COPIED_PROPS: ReadonlyArray<string> = [
  "boxSizing",
  "width",
  "height",
  "overflowX",
  "overflowY",
  "borderTopWidth",
  "borderRightWidth",
  "borderBottomWidth",
  "borderLeftWidth",
  "borderStyle",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "fontStyle",
  "fontVariant",
  "fontWeight",
  "fontStretch",
  "fontSize",
  "fontSizeAdjust",
  "lineHeight",
  "fontFamily",
  "textAlign",
  "textTransform",
  "textIndent",
  "textDecoration",
  "letterSpacing",
  "wordSpacing",
  "tabSize",
  "MozTabSize",
];

// `CSSStyleDeclaration` is indexable by camel-cased property name at
// runtime, but its TS typings only enumerate well-known properties
// (vendor prefixes like `MozTabSize` aren't included). Treat both the
// live `.style` and the read-only computed style as string-keyed
// records for the copy loop — this avoids `any` while still
// typechecking the shape we use.
type StyleRecord = Record<string, string>;

const asStyleRecord = (value: CSSStyleDeclaration): StyleRecord =>
  value as unknown as StyleRecord;

// Computed style values can be non-numeric (`lineHeight: "normal"`,
// missing borders) — `Number.parseInt` of those returns `NaN`, which
// poisons downstream math (caret height = NaN → selection rect = NaN
// → overlays collapse). Resolve to a finite fallback at the read site.
const toFiniteInt = (value: string | undefined, fallback: number): number => {
  if (!value) return fallback;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
};

/**
 * Compute the (top, left, height) of the caret at a given character
 * offset inside a `<textarea>`. Uses an invisible mirror `<div>` that
 * copies all relevant computed styles from the textarea, inserts the
 * text up to the offset followed by a zero-width marker, then measures
 * the marker's bounding rect relative to the mirror — which equals the
 * caret's position relative to the textarea's content box.
 *
 * Adapted from the technique in `textarea-caret-position`
 * (https://github.com/component/textarea-caret-position), pared down
 * to the subset needed for the awareness overlays.
 */
export const getTextareaCaretRect = (
  textarea: HTMLTextAreaElement,
  position: number,
): TextareaCaretRect => {
  const doc = textarea.ownerDocument;
  const win = doc.defaultView ?? window;

  const mirror = doc.createElement("div");
  doc.body.appendChild(mirror);

  try {
    const style = asStyleRecord(mirror.style);
    const computedDecl = win.getComputedStyle(textarea);
    const computed = asStyleRecord(computedDecl);

    // Mirror layout but render off-screen.
    style.whiteSpace = "pre-wrap";
    style.wordWrap = "break-word";
    style.position = "absolute";
    style.visibility = "hidden";
    style.top = "0";
    style.left = "0";

    for (const prop of COPIED_PROPS) {
      const value = computed[prop];
      if (value !== undefined) {
        style[prop] = value;
      }
    }

    mirror.textContent = textarea.value.substring(0, position);

    const marker = doc.createElement("span");
    // Use a zero-width space when the caret is at end-of-text so the
    // browser still lays the marker out (an empty span has no box) but
    // the marker contributes zero width to `offsetLeft` — a literal
    // `"."` would shift the measured caret right by one glyph at the
    // end of a line. Mid-text, the remaining text itself gives the
    // marker its box.
    const tail = textarea.value.substring(position);
    marker.textContent = tail.length > 0 ? tail : "​";
    mirror.appendChild(marker);

    // `lineHeight` is often `"normal"`; fall back to `fontSize`, then
    // a sane default. Border widths default to 0 when absent.
    const height =
      toFiniteInt(computed.lineHeight, Number.NaN) ||
      toFiniteInt(computed.fontSize, 20);
    return {
      top: marker.offsetTop + toFiniteInt(computed.borderTopWidth, 0),
      left: marker.offsetLeft + toFiniteInt(computed.borderLeftWidth, 0),
      height,
    };
  } finally {
    mirror.remove();
  }
};

/**
 * Build one `HighlightRect` per visible line for a textarea selection,
 * so wrapped selections render the way browsers natively highlight text:
 *
 *  - Line 1 from `from.left` to the content right edge.
 *  - Full-width middle lines.
 *  - Last line from the content left edge to `to.left`.
 *
 * A single bounding rect would paint a giant block over unselected
 * content between the wrap boundaries.
 *
 * Coordinates are textarea-content-box relative (see module doc for
 * scroll handling). The `Math.max(2, …)` floors keep degenerate rects
 * (collapsed ranges, caret at line edge) visible — 0-width rects
 * disappear and 1px rects blend with the background.
 *
 * Assumes uniform line height (textarea has a single font/leading);
 * the middle-line count uses `Math.round((end.top - start.top) /
 * lineHeight) - 1`, which is robust for integer line heights but can
 * drift off-by-one if the host has fractional `line-height` and the
 * wrap span lands near a half-line boundary. Adequate for demo-grade
 * textarea selections; richer editors should compute rects from their
 * own selection model rather than the textarea mirror.
 *
 * Returns `[]` for collapsed/inverted ranges or when the textarea
 * isn't measurable (e.g. detached, zero-width).
 */
export const getTextareaSelectionRects = (
  textarea: HTMLTextAreaElement,
  range: TextareaSelectionRange,
): HighlightRect[] => {
  const value = textarea.value;
  const fromOff = Math.min(range.from, value.length);
  const toOff = Math.min(range.to, value.length);
  if (fromOff >= toOff) return [];

  const start = getTextareaCaretRect(textarea, fromOff);
  const end = getTextareaCaretRect(textarea, toOff);
  const lineHeight = start.height || end.height || 20;

  if (start.top === end.top) {
    return [
      {
        x: start.left,
        y: start.top,
        width: Math.max(2, end.left - start.left),
        height: lineHeight,
      },
    ];
  }

  const doc = textarea.ownerDocument;
  const win = doc.defaultView ?? window;
  const cs = win.getComputedStyle(textarea);
  const padLeft = Number.parseFloat(cs.paddingLeft) || 0;
  const padRight = Number.parseFloat(cs.paddingRight) || 0;
  const contentLeft = padLeft;
  const contentRight = textarea.clientWidth - padRight;
  const contentWidth = Math.max(2, contentRight - contentLeft);

  const rects: HighlightRect[] = [];
  rects.push({
    x: start.left,
    y: start.top,
    width: Math.max(2, contentRight - start.left),
    height: lineHeight,
  });
  const middleLines = Math.max(
    0,
    Math.round((end.top - start.top) / lineHeight) - 1,
  );
  for (let i = 0; i < middleLines; i++) {
    rects.push({
      x: contentLeft,
      y: start.top + (i + 1) * lineHeight,
      width: contentWidth,
      height: lineHeight,
    });
  }
  rects.push({
    x: contentLeft,
    y: end.top,
    width: Math.max(2, end.left - contentLeft),
    height: lineHeight,
  });
  return rects;
};
