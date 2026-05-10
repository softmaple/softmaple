import { type ReactNode, useEffect, useRef, useState } from "react";
import type { PresenceUser } from "../types/presence";
import { cx, toUserColorStyle } from "./utils";

export interface LiveCursorPoint {
  readonly x: number;
  readonly y: number;
}

export interface LiveCursorProps {
  readonly user: PresenceUser;
  readonly point: LiveCursorPoint;
  readonly labelVisibleMs?: number;
  readonly showLabel?: boolean;
  readonly className?: string;
}

export const LiveCursor = ({
  user,
  point,
  labelVisibleMs = 2800,
  showLabel = true,
  className,
}: LiveCursorProps): ReactNode => {
  const [isLabelVisible, setIsLabelVisible] = useState(showLabel);
  const previousPointRef = useRef(point);

  useEffect(() => {
    if (!showLabel) {
      setIsLabelVisible(false);
      return;
    }

    const previousPoint = previousPointRef.current;
    const moved = previousPoint.x !== point.x || previousPoint.y !== point.y;
    previousPointRef.current = { x: point.x, y: point.y };

    if (moved) {
      setIsLabelVisible(true);
    }

    const timeoutId = setTimeout(() => {
      setIsLabelVisible(false);
    }, labelVisibleMs);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [labelVisibleMs, point.x, point.y, showLabel]);

  return (
    <div
      aria-label={`${user.name} cursor`}
      className={cx(
        "awareness-live-cursor",
        isLabelVisible && "awareness-live-cursor--label-visible",
        className,
      )}
      role="img"
      style={{
        ...toUserColorStyle(user.color),
        transform: `translate3d(${point.x}px, ${point.y}px, 0)`,
      }}
    >
      <span aria-hidden="true" className="awareness-live-cursor__caret" />
      {showLabel ? (
        <span className="awareness-live-cursor__label">{user.name}</span>
      ) : null}
    </div>
  );
};
