/**
 * Compute the (top, left, height) of the caret at a given character offset
 * inside a `<textarea>`. Uses an invisible mirror `<div>` that copies all
 * relevant computed styles from the textarea, inserts the text up to the
 * offset followed by a zero-width marker, then measures the marker's
 * bounding rect relative to the mirror — which equals the caret's position
 * relative to the textarea's content box.
 *
 * Adapted from the technique in `textarea-caret-position`
 * (https://github.com/component/textarea-caret-position), pared down to
 * the subset we need for the awareness demo.
 */

export interface CaretRect {
  readonly top: number;
  readonly left: number;
  readonly height: number;
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

// CSSStyleDeclaration is indexable by camel-cased property name at runtime,
// but its TS typings only enumerate well-known properties (vendor prefixes
// like `MozTabSize` aren't included). Treat both the live `.style` and the
// read-only computed style as string-keyed records for the copy loop — this
// avoids `any` while still typechecking the shape we use.
type StyleRecord = Record<string, string>;

const asStyleRecord = (value: CSSStyleDeclaration): StyleRecord =>
  value as unknown as StyleRecord;

export const caretCoordinates = (
  textarea: HTMLTextAreaElement,
  position: number,
): CaretRect => {
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
    // Zero-width but non-empty so the browser actually lays it out.
    marker.textContent = textarea.value.substring(position) || ".";
    mirror.appendChild(marker);

    return {
      top: marker.offsetTop + parseInt(computed.borderTopWidth || "0", 10),
      left: marker.offsetLeft + parseInt(computed.borderLeftWidth || "0", 10),
      height: parseInt(computed.lineHeight || computed.fontSize || "20", 10),
    };
  } finally {
    mirror.remove();
  }
};
