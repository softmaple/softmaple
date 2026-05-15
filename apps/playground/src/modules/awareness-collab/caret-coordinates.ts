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

export const caretCoordinates = (
  textarea: HTMLTextAreaElement,
  position: number,
): CaretRect => {
  const doc = textarea.ownerDocument;
  const win = doc.defaultView ?? window;

  const mirror = doc.createElement("div");
  mirror.id = "__awareness-caret-mirror";
  doc.body.appendChild(mirror);

  const style = mirror.style;
  const computed = win.getComputedStyle(textarea);

  // Mirror layout but render off-screen.
  style.whiteSpace = "pre-wrap";
  style.wordWrap = "break-word";
  style.position = "absolute";
  style.visibility = "hidden";
  style.top = "0";
  style.left = "0";

  for (const prop of COPIED_PROPS) {
    // biome-ignore lint/suspicious/noExplicitAny: indexing CSSStyleDeclaration by string
    (style as any)[prop] = (computed as any)[prop];
  }

  mirror.textContent = textarea.value.substring(0, position);

  const marker = doc.createElement("span");
  // Zero-width but non-empty so the browser actually lays it out.
  marker.textContent = textarea.value.substring(position) || ".";
  mirror.appendChild(marker);

  const rect: CaretRect = {
    top: marker.offsetTop + parseInt(computed.borderTopWidth || "0", 10),
    left: marker.offsetLeft + parseInt(computed.borderLeftWidth || "0", 10),
    height: parseInt(computed.lineHeight || computed.fontSize || "20", 10),
  };

  doc.body.removeChild(mirror);
  return rect;
};
