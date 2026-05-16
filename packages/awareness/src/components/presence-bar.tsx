import {
  type ContextType,
  type ReactNode,
  useContext,
  useId,
  useMemo,
} from "react";
import { PresenceContext } from "../providers/presence-context";
import type { PresenceUser } from "../types/presence";
import { cx, formatPresenceSummary, sortPresenceUsers } from "./internal-utils";
import { PresenceAvatar, type PresenceAvatarSize } from "./presence-avatar";

export interface PresenceBarProps {
  readonly users?: ReadonlyArray<PresenceUser>;
  readonly maxVisible?: number;
  readonly size?: PresenceAvatarSize;
  readonly includeOffline?: boolean;
  readonly emptyLabel?: string;
  readonly className?: string;
  readonly "aria-label"?: string;
  /**
   * When `true` (default) avatar items are keyboard-focusable and reveal a
   * tooltip with the user's name + status + relative last-active time on
   * hover or focus. Set to `false` to render purely decorative avatars
   * (e.g. inside a button that already exposes the same info).
   */
  readonly interactive?: boolean;
  /**
   * When `true`, render skeleton placeholders for `maxVisible` items
   * instead of the user list. Useful while the adapter is connecting.
   */
  readonly loading?: boolean;
}

const getUsersFromContext = (
  context: ContextType<typeof PresenceContext>,
): ReadonlyArray<PresenceUser> => {
  if (context === null) return [];
  return Array.from(context.presence.values());
};

export const PresenceBar = ({
  users,
  maxVisible = 5,
  size = "md",
  includeOffline = false,
  emptyLabel = "No collaborators online",
  className,
  "aria-label": ariaLabel = "Collaborators",
  interactive = true,
  loading = false,
}: PresenceBarProps): ReactNode => {
  const context = useContext(PresenceContext);
  const tooltipIdBase = useId();

  const visibleUsers = useMemo(() => {
    const source = users ?? getUsersFromContext(context);
    const filtered = includeOffline
      ? source
      : source.filter((user) => user.status !== "offline");
    return sortPresenceUsers(filtered);
  }, [context, includeOffline, users]);

  const shownUsers = visibleUsers.slice(0, maxVisible);
  const overflowUsers = visibleUsers.slice(maxVisible);
  const overflowLabel = overflowUsers.map((user) => user.name).join(", ");

  if (loading) {
    return (
      <>
        {/*
          AT-only loading status. The skeleton dots intentionally don't
          animate (design §6) and convey nothing without a label, so we
          surface "Loading collaborators…" via a sibling status region
          and aria-hide the placeholder list items.
        */}
        {/* biome-ignore lint/a11y/useSemanticElements: <output> is for form-calculated values; this is a loading state for an inert chrome region, so a span with role="status" is the appropriate live region (mirrors block-activity-indicator). */}
        <span className="awareness-sr-only" role="status">
          Loading collaborators…
        </span>
        <ul
          aria-busy="true"
          aria-label={ariaLabel}
          className={cx("awareness-presence-bar", className)}
        >
          {Array.from({ length: maxVisible }).map((_, index) => (
            <li
              aria-hidden="true"
              // biome-ignore lint/suspicious/noArrayIndexKey: skeleton placeholders have no stable identity.
              key={`skeleton-${index}`}
              className={cx(
                "awareness-presence-bar__item",
                "awareness-presence-bar__item--skeleton",
                `awareness-presence-bar__item--skeleton-${size}`,
              )}
            >
              <span
                aria-hidden="true"
                className="awareness-presence-bar__skeleton"
              />
            </li>
          ))}
        </ul>
      </>
    );
  }

  return (
    <ul
      aria-label={ariaLabel}
      className={cx("awareness-presence-bar", className)}
    >
      {shownUsers.length > 0 ? (
        shownUsers.map((user) => {
          const tooltipId = `${tooltipIdBase}-${user.userId}`;
          const summary = formatPresenceSummary(user);
          return (
            <li
              className={cx(
                "awareness-presence-bar__item",
                interactive && "awareness-presence-bar__item--interactive",
              )}
              key={user.userId}
            >
              {interactive ? (
                // <button> gives us a real focusable element with the
                // right AT semantics (announces as "Pikachu, button"
                // not "list item"). The tooltip text is wired through
                // aria-describedby so AT reads name first, then the
                // status + last-active meta.
                <button
                  aria-describedby={tooltipId}
                  aria-label={user.name}
                  className="awareness-presence-bar__button"
                  type="button"
                >
                  <PresenceAvatar size={size} user={user} />
                </button>
              ) : (
                <PresenceAvatar size={size} user={user} />
              )}
              {interactive ? (
                <span
                  className="awareness-presence-bar__tooltip"
                  id={tooltipId}
                  role="tooltip"
                >
                  <span className="awareness-presence-bar__tooltip-name">
                    {user.name}
                  </span>
                  <span className="awareness-presence-bar__tooltip-meta">
                    {summary}
                  </span>
                </span>
              ) : null}
            </li>
          );
        })
      ) : (
        <li className="awareness-presence-bar__empty">{emptyLabel}</li>
      )}
      {overflowUsers.length > 0 ? (
        <li
          aria-label={`${overflowUsers.length} more collaborators: ${overflowLabel}`}
          className={cx(
            "awareness-presence-bar__overflow",
            `awareness-presence-bar__overflow--${size}`,
          )}
          title={overflowLabel}
        >
          +{overflowUsers.length}
        </li>
      ) : null}
    </ul>
  );
};
