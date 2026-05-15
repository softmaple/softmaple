import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getTextareaCaretRect,
  getTextareaSelectionRects,
} from "./textarea-rects";

/**
 * jsdom's layout engine is a no-op (offsetTop/offsetLeft return 0 for
 * everything, `getComputedStyle` only echoes inline styles back), so we
 * can't pixel-assert against a "real" wrap. These tests exercise the
 * *shape* of the contract — that the helpers don't throw on degenerate
 * inputs, return `[]` for collapsed ranges, and emit one rect for
 * single-line selections — which is the bug class consumers hit when
 * they reinvent it inline.
 */
let textarea: HTMLTextAreaElement | undefined;

afterEach(() => {
  textarea?.remove();
  textarea = undefined;
});

const makeTextarea = (value: string): HTMLTextAreaElement => {
  const el = document.createElement("textarea");
  el.value = value;
  el.style.fontSize = "16px";
  el.style.lineHeight = "20px";
  el.style.padding = "8px";
  el.style.border = "1px solid black";
  el.style.width = "200px";
  document.body.appendChild(el);
  textarea = el;
  return el;
};

describe("getTextareaCaretRect", () => {
  it("returns a finite caret rect for offset 0", () => {
    const el = makeTextarea("hello world");
    const rect = getTextareaCaretRect(el, 0);

    // Finite numbers — the helper's `toFiniteInt` fallback for
    // missing computed styles is the easy thing to break and the easy
    // thing to forget to test.
    expect(Number.isFinite(rect.top)).toBe(true);
    expect(Number.isFinite(rect.left)).toBe(true);
    expect(Number.isFinite(rect.height)).toBe(true);
    expect(rect.height).toBeGreaterThan(0);
  });

  it("clamps gracefully when position exceeds the value length", () => {
    const el = makeTextarea("hi");
    expect(() => getTextareaCaretRect(el, 999)).not.toThrow();
  });

  it("cleans up the off-screen mirror element after measurement", () => {
    const el = makeTextarea("anything");
    const before = document.body.children.length;
    getTextareaCaretRect(el, 3);
    expect(document.body.children.length).toBe(before);
  });
});

describe("getTextareaSelectionRects", () => {
  it("returns an empty array for collapsed ranges", () => {
    const el = makeTextarea("hello");
    expect(getTextareaSelectionRects(el, { from: 2, to: 2 })).toEqual([]);
  });

  it("returns an empty array for inverted ranges", () => {
    const el = makeTextarea("hello world");
    expect(getTextareaSelectionRects(el, { from: 8, to: 3 })).toEqual([]);
  });

  it("clamps `from`/`to` to the textarea's value length", () => {
    const el = makeTextarea("hi");
    expect(() =>
      getTextareaSelectionRects(el, { from: 0, to: 999 }),
    ).not.toThrow();
  });

  it("emits a single rect when start and end sit on the same line", () => {
    const el = makeTextarea("hello world");
    const rects = getTextareaSelectionRects(el, { from: 0, to: 5 });

    expect(rects).toHaveLength(1);
    const rect = rects[0];
    if (!rect) throw new Error("expected one rect");
    expect(Number.isFinite(rect.x)).toBe(true);
    expect(Number.isFinite(rect.y)).toBe(true);
    // The `Math.max(2, …)` floor guarantees the rect is visible even
    // when jsdom collapses widths to zero.
    expect(rect.width).toBeGreaterThanOrEqual(2);
    expect(rect.height).toBeGreaterThan(0);
  });

  describe("multi-line selections (stubbed layout)", () => {
    // jsdom's offsetTop is always 0, so every selection collapses to one
    // rect. Stub `HTMLElement.prototype.offsetTop` to fake line wrapping:
    // each newline in the marker's preceding text node bumps offsetTop
    // by one line. This exercises the per-line rect emission branch.
    //
    // The stub touches `HTMLElement.prototype` globally. Vitest's default
    // isolation (one VM per test file) keeps the override from leaking
    // across files; the `afterEach` restore covers leakage within this
    // file. If we ever switch to shared-environment mode, this stub
    // becomes a footgun and should move behind a per-test wrapper.
    const LINE = 20;
    let originalOffsetTop: PropertyDescriptor | undefined;

    beforeEach(() => {
      originalOffsetTop = Object.getOwnPropertyDescriptor(
        HTMLElement.prototype,
        "offsetTop",
      );
      Object.defineProperty(HTMLElement.prototype, "offsetTop", {
        get(this: HTMLElement) {
          // Only the mirror's marker span has a preceding text node
          // carrying `textarea.value.substring(0, position)`. Everything
          // else stays at jsdom's default 0.
          const prev = this.previousSibling;
          if (!prev || prev.nodeType !== Node.TEXT_NODE) return 0;
          const text = prev.textContent ?? "";
          const newlines = (text.match(/\n/g) ?? []).length;
          return newlines * LINE;
        },
        configurable: true,
      });
    });

    afterEach(() => {
      if (originalOffsetTop) {
        Object.defineProperty(
          HTMLElement.prototype,
          "offsetTop",
          originalOffsetTop,
        );
      }
    });

    it("emits one rect per line when start and end span multiple lines", () => {
      const el = makeTextarea("line one\nline two\nline three");
      const rects = getTextareaSelectionRects(el, {
        from: 0,
        to: el.value.length,
      });

      // First line + at least one middle + last line = 3 minimum.
      expect(rects.length).toBeGreaterThanOrEqual(3);

      const [first, middle, last] = rects;
      if (!first || !middle || !last) {
        throw new Error("expected at least three rects");
      }
      // Vertical stride matches the stubbed line height.
      expect(middle.y - first.y).toBe(LINE);
      expect(last.y - middle.y).toBe(LINE);
      // All rects have a visible width (the Math.max(2, …) floor).
      for (const rect of rects) {
        expect(rect.width).toBeGreaterThanOrEqual(2);
        expect(rect.height).toBe(LINE);
      }
    });

    it("falls back to `window` when textarea.ownerDocument.defaultView is null", () => {
      // Edge branch in the multi-line path: `doc.defaultView ?? window`.
      const el = makeTextarea("line one\nline two\nline three");
      Object.defineProperty(el.ownerDocument, "defaultView", {
        value: null,
        configurable: true,
      });
      const rects = getTextareaSelectionRects(el, {
        from: 0,
        to: el.value.length,
      });
      // Stronger than `not.toThrow`: the fallback must still produce a
      // well-formed multi-line result. A silent partial-result regression
      // would slip past a no-throw assertion.
      expect(rects.length).toBeGreaterThanOrEqual(3);
      for (const rect of rects) {
        expect(Number.isFinite(rect.x)).toBe(true);
        expect(Number.isFinite(rect.y)).toBe(true);
        expect(rect.width).toBeGreaterThanOrEqual(2);
      }
    });

    it("falls back when paddingLeft/paddingRight are unparseable", () => {
      // Covers the `Number.parseFloat(cs.paddingLeft) || 0` and
      // matching paddingRight branches. jsdom returns "" for an unset
      // padding-left when no inline padding is set on the side, which
      // `parseFloat` resolves to NaN.
      const el = document.createElement("textarea");
      el.value = "line one\nline two\nline three";
      el.style.fontSize = "16px";
      el.style.lineHeight = "20px";
      el.style.width = "200px";
      // Deliberately no paddingLeft/Right set.
      document.body.appendChild(el);
      textarea = el;

      const rects = getTextareaSelectionRects(el, {
        from: 0,
        to: el.value.length,
      });
      expect(rects.length).toBeGreaterThanOrEqual(3);
      // contentLeft = padLeft = 0, so the middle / last rects' x is
      // exactly 0 — proves the fallback fired.
      const middle = rects[1];
      if (!middle) throw new Error("expected a middle rect");
      expect(middle.x).toBe(0);
    });
  });

  it("returns coordinates in textarea-content space (not scroll-subtracted)", () => {
    const el = makeTextarea("hello world");
    // Setting scrollLeft / scrollTop doesn't change a jsdom layout's
    // measurements, but the helper should also not subtract them — a
    // consumer passes `<PresenceLayer trackHostScroll />` to fold them
    // in. This guards against accidentally re-introducing the scroll
    // subtraction the helper used to do when it lived in the
    // playground.
    el.scrollLeft = 10;
    el.scrollTop = 20;
    const rects = getTextareaSelectionRects(el, { from: 0, to: 4 });
    expect(rects.length).toBeGreaterThan(0);
    const rect = rects[0];
    if (!rect) throw new Error("expected at least one rect");
    // x/y should be content-relative (>=0 for a 0-start selection),
    // not negative because of scroll subtraction.
    expect(rect.x).toBeGreaterThanOrEqual(0);
    expect(rect.y).toBeGreaterThanOrEqual(0);
  });
});
