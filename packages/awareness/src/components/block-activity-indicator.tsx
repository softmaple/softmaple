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

import { type ContextType, type ReactNode, useContext, useMemo } from "react";
import { PresenceContext } from "../providers/presence-context";
import type { PresenceUser } from "../types/presence";
import { cx } from "./utils";

export interface BlockActivityIndicatorProps {
  /** The block this indicator is anchored to. */
  readonly blockId: string;
  /**
   * Override the user list. Defaults to the users provided by
   * `PresenceContext` (excluding `self`).
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
  /** Label when nobody is in the block (only used with `renderWhenEmpty`). */
  readonly emptyLabel?: string;
  /**
   * Custom label formatter. Receives users currently in the block.
   * Defaults to the §5.4 phrasing.
   */
  readonly formatLabel?: (users: ReadonlyArray<PresenceUser>) => string;
  readonly className?: string;
  readonly "aria-label"?: string;
}

const getUsersFromContext = (
  context: ContextType<typeof PresenceContext>,
  includeSelf: boolean,
): ReadonlyArray<PresenceUser> => {
  if (context === null) return [];
  if (includeSelf) return Array.from(context.presence.values());
  return context.others;
};

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
}: BlockActivityIndicatorProps): ReactNode => {
  const context = useContext(PresenceContext);

  const activeUsers = useMemo(() => {
    const source = users ?? getUsersFromContext(context, includeSelf);
    return source.filter((user) => {
      if (!includeOffline && user.status === "offline") return false;
      return isUserInBlock(user, blockId);
    });
  }, [blockId, context, includeOffline, includeSelf, users]);

  if (activeUsers.length === 0 && !renderWhenEmpty) return null;

  const label =
    activeUsers.length === 0 ? emptyLabel : formatLabel(activeUsers);
  const primaryColor = activeUsers[0]?.color;

  return (
    <output
      aria-label={ariaLabel ?? label}
      aria-live="polite"
      className={cx("awareness-block-activity-indicator", className)}
      style={
        primaryColor
          ? ({ "--awareness-user-color": primaryColor } as Record<
              string,
              string
            >)
          : undefined
      }
    >
      <span
        aria-hidden="true"
        className="awareness-block-activity-indicator__dot"
      />
      <span className="awareness-block-activity-indicator__text">{label}</span>
    </output>
  );
};
