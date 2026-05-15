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
}: SelectionHighlightProps): ReactNode => {
  const isHoverLabel = showLabel === "hover";
  const renderLabel = showLabel === true || isHoverLabel;

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
      // reveals the user badge via CSS `:focus-visible`. Each visible
      // selection adds one tab stop — intentional, so screen-reader /
      // keyboard users can inspect attribution without a pointer.
      tabIndex={isHoverLabel ? 0 : undefined}
    >
      {renderLabel ? (
        <span className="awareness-selection-highlight__label">
          {user.name}
        </span>
      ) : null}
    </div>
  );
};
