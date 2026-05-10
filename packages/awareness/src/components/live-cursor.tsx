import { type ReactNode, useEffect, useReducer, useRef, useState } from "react";
import type { PresenceUser } from "../types/presence";
import { cx, toUserColorStyle } from "./utils";

export interface LiveCursorPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * Rectangle the cursor must intersect to be rendered. Cursors fully outside
 * are culled per design doc §7 ("Off-screen cursors not rendered").
 *
 * `"window"` (default) reads `window.innerWidth`/`innerHeight` and re-evaluates
 * on `resize` so cursors at the edge cull/uncull correctly. `"none"` disables
 * culling (useful inside virtualized scrollers that cull upstream); or pass an
 * explicit rect.
 */
export type LiveCursorViewport =
  | "window"
  | "none"
  | {
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
    };

export interface LiveCursorProps {
  readonly user: PresenceUser;
  readonly point: LiveCursorPoint;
  readonly labelVisibleMs?: number;
  readonly showLabel?: boolean;
  readonly className?: string;
  /**
   * Bounds used for off-screen culling. Defaults to the current window.
   * Set to `"none"` to always render (e.g. inside a virtualized scroller
   * where you've already culled upstream).
   */
  readonly viewport?: LiveCursorViewport;
  /**
   * Extra margin in pixels added to the viewport so cursors just outside
   * the edge are still rendered (avoids flicker at the boundary).
   * Defaults to 32.
   */
  readonly cullMargin?: number;
}

const isPointInViewport = (
  point: LiveCursorPoint,
  viewport: LiveCursorViewport,
  margin: number,
): boolean => {
  if (viewport === "none") return true;

  let bounds: { x: number; y: number; width: number; height: number };
  if (viewport === "window") {
    if (typeof window === "undefined") return true;
    bounds = {
      x: 0,
      y: 0,
      width: window.innerWidth,
      height: window.innerHeight,
    };
  } else {
    bounds = viewport;
  }

  return (
    point.x >= bounds.x - margin &&
    point.x <= bounds.x + bounds.width + margin &&
    point.y >= bounds.y - margin &&
    point.y <= bounds.y + bounds.height + margin
  );
};

export const LiveCursor = ({
  user,
  point,
  labelVisibleMs = 3000,
  showLabel = true,
  className,
  viewport = "window",
  cullMargin = 32,
}: LiveCursorProps): ReactNode => {
  const [isLabelVisible, setIsLabelVisible] = useState(showLabel);
  const previousPointRef = useRef(point);

  // Re-evaluate window-based culling on resize so cursors near the edge
  // cull/uncull correctly without waiting for the next pointer move.
  const [, bumpResize] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    if (viewport !== "window" || typeof window === "undefined") return;
    const handler = (): void => {
      bumpResize();
    };
    window.addEventListener("resize", handler, { passive: true });
    return () => {
      window.removeEventListener("resize", handler);
    };
  }, [viewport]);

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

  if (!isPointInViewport(point, viewport, cullMargin)) {
    return null;
  }

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
