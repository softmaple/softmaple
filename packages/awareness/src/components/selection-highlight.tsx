import type { CSSProperties, ReactNode } from "react";
import type { PresenceUser } from "../types/presence";
import { cx, toUserColorStyle } from "./internal-utils";
import {
  usePresenceLayerOffset,
  warnMissingPresenceLayerOnce,
} from "./presence-layer";

export interface HighlightRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface SelectionHighlightProps {
  readonly user: PresenceUser;
  readonly rect: HighlightRect;
  readonly selectedText?: string;
  /**
   * When `true`, the user badge is always visible.
   * When `false` (default), the badge is hidden.
   * When `"hover"`, the badge is hidden until the highlight is hovered or
   * keyboard-focused — matches design doc §5.3 ("Hover reveals user badge").
   */
  readonly showLabel?: boolean | "hover";
  readonly className?: string;
  readonly style?: CSSProperties;
  /**
   * Whether the highlight participates in the keyboard tab order so
   * screen-reader / keyboard users can focus it to surface the
   * attribution badge. Defaults to `showLabel === "hover"` so the
   * hover label remains keyboard-discoverable. Editors with many
   * peers can pass `focusable={false}` (e.g. for sibling rects of a
   * multi-line selection that already render unlabeled) to avoid
   * inserting extra tab stops ahead of the host's own controls.
   */
  readonly focusable?: boolean;
}

const ARIA_LABEL_MAX_TEXT = 120;

const getSelectionLabel = (
  user: PresenceUser,
  selectedText: string | undefined,
): string => {
  if (selectedText === undefined || selectedText.length === 0) {
    return `${user.name} selection`;
  }
  const clamped =
    selectedText.length > ARIA_LABEL_MAX_TEXT
      ? `${selectedText.slice(0, ARIA_LABEL_MAX_TEXT)}…`
      : selectedText;
  return `${user.name} selection: ${clamped}`;
};

export const SelectionHighlight = ({
  user,
  rect,
  selectedText,
  showLabel = false,
  className,
  style,
  focusable,
}: SelectionHighlightProps): ReactNode => {
  const isHoverLabel = showLabel === "hover";
  const renderLabel = showLabel === true || isHoverLabel;
  // Default `focusable` to the legacy implicit behavior (focusable
  // when the label is hover-revealed) so existing stories keep their
  // keyboard-discoverable badge. Editors with many peers — or sibling
  // rects of a multi-line selection that don't render a label — can
  // pass `focusable={false}` to avoid burning extra tab stops.
  const isFocusable = focusable ?? isHoverLabel;

  // `SelectionHighlight` requires a `<PresenceLayer>` ancestor — the
  // layer owns the host's bounding rect, which is the only sane reference
  // frame for overlay coordinates. Without one, the highlight would
  // render at the wrong position (the bug class this API was introduced
  // to remove), so we render nothing instead.
  const layerOffset = usePresenceLayerOffset();
  if (layerOffset === null) {
    warnMissingPresenceLayerOnce("SelectionHighlight");
    return null;
  }
  const screenX = rect.x + layerOffset.left;
  const screenY = rect.y + layerOffset.top;

  return (
    <div
      aria-label={getSelectionLabel(user, selectedText)}
      className={cx(
        "awareness-selection-highlight",
        isHoverLabel && "awareness-selection-highlight--hoverable",
        className,
      )}
      role="img"
      style={{
        ...toUserColorStyle(user.color),
        height: rect.height,
        transform: `translate3d(${screenX}px, ${screenY}px, 0)`,
        width: rect.width,
        ...style,
      }}
      // Hover variant is keyboard-discoverable: focusing the highlight
      // reveals the user badge via CSS `:focus-visible`. Each focusable
      // selection adds one tab stop — the host opts into that budget
      // via the `focusable` prop (default: `showLabel === "hover"`).
      tabIndex={isFocusable ? 0 : undefined}
    >
      {renderLabel ? (
        <span className="awareness-selection-highlight__label">
          {user.name}
        </span>
      ) : null}
    </div>
  );
};
