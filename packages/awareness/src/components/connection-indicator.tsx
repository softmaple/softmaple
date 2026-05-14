import { type ReactNode, useContext } from "react";
import type { AdapterConnectionState } from "../adapters/types";
import { PresenceContext } from "../providers/presence-context";
import { cx } from "./internal-utils";

export interface ConnectionIndicatorLabels {
  readonly disconnected: string;
  readonly connecting: string;
  readonly connected: string;
  readonly reconnecting: string;
  readonly error: string;
}

const DEFAULT_LABELS: ConnectionIndicatorLabels = {
  disconnected: "Offline",
  connecting: "Connecting…",
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

  if (hideWhenConnected && resolved === "connected") return null;

  const copy = { ...DEFAULT_LABELS, ...labels };
  const text = copy[resolved];

  return (
    // biome-ignore lint/a11y/useSemanticElements: <output> is for form-calculated values; this is transport telemetry, so a div with role="status" is the semantically appropriate live region (mirrors block-activity-indicator).
    <div
      aria-label={ariaLabel ?? text}
      aria-live="polite"
      className={cx(
        "awareness-connection-indicator",
        `awareness-connection-indicator--${resolved}`,
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
