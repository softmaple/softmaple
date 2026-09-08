import { type ReactNode, useEffect, useReducer, useRef, useState } from "react";
import type { PresenceUser } from "../types/presence";
import { cx, toUserColorStyle } from "./internal-utils";
import {
  usePresenceLayerOffset,
  warnMissingPresenceLayerOnce,
} from "./presence-layer";

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
  /** Measured line height in CSS pixels. Omit to use the themed caret height. */
  readonly caretHeight?: number;
  /**
   * Controls how the user label is presented.
   * - `true` (default): label shows on mount and after every move, then
   *   auto-hides after `labelVisibleMs`.
   * - `false`: label is never rendered.
   * - `"hover"`: label is hidden until the caret is hovered or keyboard-
   *   focused — matches the same opt-in pattern used by
   *   `SelectionHighlight` (design doc §5.3 "Hover reveals user badge").
   */
  readonly showLabel?: boolean | "hover";
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
  /**
   * Whether the cursor participates in the keyboard tab order so
   * screen-reader / keyboard users can focus it to surface the
   * attribution badge. Defaults to `showLabel === "hover"` so the
   * hover label remains keyboard-discoverable. Editors with many
   * peers can pass `focusable={false}` to avoid burning up to `N` tab
   * stops on remote cursors when keyboard users need to reach the
   * host's own focusable controls first.
   */
  readonly focusable?: boolean;
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
  caretHeight,
  showLabel = true,
  className,
  viewport = "window",
  cullMargin = 32,
  focusable,
}: LiveCursorProps): ReactNode => {
  const isHoverLabel = showLabel === "hover";
  const renderLabel = showLabel === true || isHoverLabel;
  // Default `focusable` to the legacy implicit behavior (focusable
  // when the label is hover-revealed) so existing consumers don't see
  // their tab order shift. Editors that want to suppress remote-cursor
  // tab stops can pass `focusable={false}` explicitly.
  const isFocusable = focusable ?? isHoverLabel;
  // Auto-fade only applies to the always-on label. The hover variant lets
  // CSS :hover / :focus-visible drive opacity, so we don't toggle the
  // `--label-visible` class for it.
  const [isLabelVisible, setIsLabelVisible] = useState(showLabel === true);
  const previousPointRef = useRef(point);

  // `LiveCursor` requires a `<PresenceLayer>` ancestor — the layer owns the
  // host's bounding rect, which is the only sane reference frame for
  // overlay coordinates. Without one, the cursor would render at the
  // wrong position (the original bug class this API was introduced to
  // remove), so we render nothing instead.
  const layerOffset = usePresenceLayerOffset();

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

  // One auto-hide timer survives across many coord updates. Using a ref
  // (rather than scheduling inside the effect cleanup) lets us *not*
  // re-arm the fade on every sub-second move during sustained typing —
  // the previous behavior kept the label permanently visible whenever a
  // peer was actively editing, defeating §6's "label fades when active"
  // promise. Now the label flashes once per burst and only re-shows
  // after the prior burst has fully faded.
  const labelHideTimeoutRef = useRef<number | null>(null);
  const isInitialLabelMountRef = useRef(true);

  useEffect(() => {
    if (showLabel !== true) {
      setIsLabelVisible(false);
      if (labelHideTimeoutRef.current !== null) {
        window.clearTimeout(labelHideTimeoutRef.current);
        labelHideTimeoutRef.current = null;
      }
      return;
    }

    const isInitial = isInitialLabelMountRef.current;
    isInitialLabelMountRef.current = false;

    const previousPoint = previousPointRef.current;
    const moved = previousPoint.x !== point.x || previousPoint.y !== point.y;
    previousPointRef.current = { x: point.x, y: point.y };

    // Nothing changed — no need to touch the label.
    if (!isInitial && !moved) return;
    // A burst is already in flight — let it fade naturally.
    if (labelHideTimeoutRef.current !== null) return;

    setIsLabelVisible(true);
    labelHideTimeoutRef.current = window.setTimeout(() => {
      setIsLabelVisible(false);
      labelHideTimeoutRef.current = null;
    }, labelVisibleMs);
  }, [labelVisibleMs, point.x, point.y, showLabel]);

  useEffect(() => {
    return () => {
      if (labelHideTimeoutRef.current !== null) {
        window.clearTimeout(labelHideTimeoutRef.current);
      }
    };
  }, []);

  if (layerOffset === null) {
    warnMissingPresenceLayerOnce("LiveCursor");
    return null;
  }
  const screenPoint = {
    x: point.x + layerOffset.left,
    y: point.y + layerOffset.top,
  };

  if (!isPointInViewport(screenPoint, viewport, cullMargin)) {
    return null;
  }

  return (
    <div
      aria-label={`${user.name} cursor`}
      className={cx(
        "awareness-live-cursor",
        isLabelVisible && "awareness-live-cursor--label-visible",
        isHoverLabel && "awareness-live-cursor--hoverable",
        className,
      )}
      role="img"
      style={{
        ...toUserColorStyle(user.color),
        transform: `translate3d(${screenPoint.x}px, ${screenPoint.y}px, 0)`,
      }}
      // Hover variant is keyboard-discoverable: focusing the caret
      // reveals the user badge via CSS `:focus-visible`. Each focusable
      // peer adds one tab stop — the host opts into that budget via
      // the `focusable` prop (default: `showLabel === "hover"`).
      tabIndex={isFocusable ? 0 : undefined}
    >
      <span
        aria-hidden="true"
        className="awareness-live-cursor__caret"
        style={{ height: caretHeight }}
      />
      {renderLabel ? (
        <span className="awareness-live-cursor__label">{user.name}</span>
      ) : null}
    </div>
  );
};
