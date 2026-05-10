import type { CSSProperties, ReactNode } from "react";
import type { PresenceUser } from "../types/presence";
import { cx, toUserColorStyle } from "./utils";

export interface HighlightRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface SelectionHighlightProps {
  readonly user: PresenceUser;
  readonly rect: HighlightRect;
  readonly showLabel?: boolean;
  readonly className?: string;
  readonly style?: CSSProperties;
}

export const SelectionHighlight = ({
  user,
  rect,
  showLabel = false,
  className,
  style,
}: SelectionHighlightProps): ReactNode => (
  <div
    aria-label={`${user.name} selection`}
    className={cx("awareness-selection-highlight", className)}
    role="img"
    style={{
      ...toUserColorStyle(user.color),
      height: rect.height,
      transform: `translate3d(${rect.x}px, ${rect.y}px, 0)`,
      width: rect.width,
      ...style,
    }}
  >
    {showLabel ? (
      <span className="awareness-selection-highlight__label">{user.name}</span>
    ) : null}
  </div>
);
