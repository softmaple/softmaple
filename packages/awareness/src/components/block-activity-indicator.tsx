/**
 * BlockActivityIndicator - per-block aggregated presence indicator.
 *
 * Implements design doc §5.4 ("Activity Indicator / Action Awareness"):
 *   - "Adam is editing this paragraph"
 *   - "2 people editing here"
 *
 * Unlike `ActivityIndicator` (a recent-event log), this component answers the
 * question "who is in *this* block right now?" by filtering active/idle peers
 * whose cursor or selection lives in the given `blockId`.
 */

import { type ReactNode, useContext, useMemo } from "react";
import { PresenceContext } from "../providers/presence-context";
import type { PresenceUser } from "../types/presence";
import { cx, toUserColorStyle } from "./internal-utils";

export interface BlockActivityIndicatorProps {
  /** The block this indicator is anchored to. */
  readonly blockId: string;
  /**
   * Override the user list. Defaults to `PresenceContext.others` when
   * `includeSelf` is false (the default), or `PresenceContext.presence`
   * otherwise.
   */
  readonly users?: ReadonlyArray<PresenceUser>;
  /** Whether to count the current user. Defaults to `false`. */
  readonly includeSelf?: boolean;
  /**
   * Whether to count offline users. Defaults to `false` — offline peers are
   * irrelevant for "who is editing here right now".
   */
  readonly includeOffline?: boolean;
  /**
   * Render the indicator even when nobody is in the block. Defaults to
   * `false` (component renders `null`).
   */
  readonly renderWhenEmpty?: boolean;
  /**
   * Label rendered when `renderWhenEmpty` is true and nobody is currently
   * editing the block.
   */
  readonly emptyLabel?: string;
  /**
   * Custom label formatter. Receives users currently in the block.
   * Defaults to the §5.4 phrasing.
   */
  readonly formatLabel?: (users: ReadonlyArray<PresenceUser>) => string;
  readonly className?: string;
  readonly "aria-label"?: string;
  /**
   * Politeness for the underlying live region. Defaults to `"off"` —
   * cursor enter/exit churn would otherwise stream "Pikachu is editing
   * here" → "2 trainers editing here" announcements through every screen
   * reader, drowning out the user's own editing flow. Sighted users
   * still see the visible pill. Pass `"polite"` if you want the
   * transitions announced anyway.
   */
  readonly ariaLive?: "off" | "polite" | "assertive";
}

const isUserInBlock = (user: PresenceUser, blockId: string): boolean =>
  user.cursor?.blockId === blockId || user.selection?.blockId === blockId;

const defaultFormatLabel = (users: ReadonlyArray<PresenceUser>): string => {
  if (users.length === 0) return "";
  if (users.length === 1) {
    const [user] = users;
    return user ? `${user.name} is editing this block` : "";
  }
  return `${users.length} people editing here`;
};

export const BlockActivityIndicator = ({
  blockId,
  users,
  includeSelf = false,
  includeOffline = false,
  renderWhenEmpty = false,
  emptyLabel = "No one editing here",
  formatLabel = defaultFormatLabel,
  className,
  "aria-label": ariaLabel,
  ariaLive = "off",
}: BlockActivityIndicatorProps): ReactNode => {
  const context = useContext(PresenceContext);
  // Narrow the memo deps so unrelated context churn (e.g. a new
  // `recentActivity` entry) does not re-filter the users list.
  const ctxOthers = context?.others;
  const ctxPresence = context?.presence;

  const activeUsers = useMemo(() => {
    let source: ReadonlyArray<PresenceUser>;
    if (users !== undefined) {
      source = users;
    } else if (includeSelf) {
      source = ctxPresence ? Array.from(ctxPresence.values()) : [];
    } else {
      source = ctxOthers ?? [];
    }
    return source.filter((user) => {
      if (!includeOffline && user.status === "offline") return false;
      return isUserInBlock(user, blockId);
    });
  }, [blockId, ctxOthers, ctxPresence, includeOffline, includeSelf, users]);

  if (activeUsers.length === 0 && !renderWhenEmpty) return null;

  const label =
    activeUsers.length === 0 ? emptyLabel : formatLabel(activeUsers);
  const primaryColor = activeUsers[0]?.color;

  return (
    // biome-ignore lint/a11y/useSemanticElements: <output> is for form-calculated values; this is presence telemetry, so a div with role="status" is the semantically appropriate live region.
    <div
      aria-label={ariaLabel ?? label}
      aria-live={ariaLive}
      className={cx("awareness-block-activity-indicator", className)}
      role="status"
      style={primaryColor ? toUserColorStyle(primaryColor) : undefined}
    >
      <span
        aria-hidden="true"
        className="awareness-block-activity-indicator__dot"
      />
      <span className="awareness-block-activity-indicator__text">{label}</span>
    </div>
  );
};
