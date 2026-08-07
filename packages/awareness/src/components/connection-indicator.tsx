import { type ReactNode, useContext } from "react";
import type { AdapterConnectionState } from "../adapters/types";
import { PresenceContext } from "../providers/presence-context";
import { cx } from "./internal-utils";

export interface ConnectionIndicatorLabels {
  readonly disconnected: string;
  readonly connecting: string;
  readonly authenticating: string;
  readonly syncing: string;
  readonly connected: string;
  readonly reconnecting: string;
  readonly error: string;
}

const DEFAULT_LABELS: ConnectionIndicatorLabels = {
  disconnected: "Offline",
  connecting: "Connecting…",
  authenticating: "Signing in…",
  syncing: "Syncing…",
  connected: "Live",
  reconnecting: "Reconnecting…",
  error: "Can't reach the server",
};

export interface ConnectionIndicatorProps {
  /**
   * Override the connection state. Defaults to `PresenceContext.connectionState`.
   */
  readonly state?: AdapterConnectionState;
  /**
   * Hide the component entirely once `state === "connected"`. Defaults to
   * `true` — the design doc favors calm UI, so a healthy connection
   * shouldn't take screen real estate.
   */
  readonly hideWhenConnected?: boolean;
  /**
   * Per-state copy. Useful for translation or product tone.
   */
  readonly labels?: Partial<ConnectionIndicatorLabels>;
  readonly className?: string;
  readonly "aria-label"?: string;
}

/**
 * ConnectionIndicator — a low-noise indicator reflecting the adapter's
 * connection lifecycle. Renders nothing when connected (by default) so
 * it stays out of the way unless the room is actually degraded.
 *
 * Aligned with design doc §2.1 ("visible but ignorable") and §8 ("color
 * is never the sole signal" — every state ships a text label and an
 * icon glyph).
 */
export const ConnectionIndicator = ({
  state,
  hideWhenConnected = true,
  labels,
  className,
  "aria-label": ariaLabel,
}: ConnectionIndicatorProps): ReactNode => {
  const context = useContext(PresenceContext);
  const resolved: AdapterConnectionState =
    state ?? context?.connectionState ?? "disconnected";

  const copy = { ...DEFAULT_LABELS, ...labels };
  const text = copy[resolved];
  // When `hideWhenConnected` and we're connected, keep the children
  // rendered so the wrapper's layout box stays the same width — but
  // visually hide and AT-hide them. Returning `null` here caused
  // sibling chrome (e.g. PresenceBar) to expand into the gap on every
  // connect/reconnect transition, producing a jarring reflow.
  const visuallyHidden = hideWhenConnected && resolved === "connected";

  return (
    // biome-ignore lint/a11y/useSemanticElements: <output> is for form-calculated values; this is transport telemetry, so a div with role="status" is the semantically appropriate live region (mirrors block-activity-indicator).
    <div
      // Only set `aria-label` when a consumer overrides it. Without an
      // override the visible `<span class="…__text">` provides the
      // accessible name; setting `aria-label` to the same string would
      // suppress AT from announcing the inner text and produce no
      // observable difference except a duplicated string in the DOM.
      aria-label={ariaLabel}
      aria-hidden={visuallyHidden ? true : undefined}
      aria-live="polite"
      className={cx(
        "awareness-connection-indicator",
        `awareness-connection-indicator--${resolved}`,
        visuallyHidden && "awareness-connection-indicator--placeholder",
        className,
      )}
      role="status"
    >
      <span
        aria-hidden="true"
        className="awareness-connection-indicator__glyph"
      />
      <span className="awareness-connection-indicator__text">{text}</span>
    </div>
  );
};
