import { type ContextType, type ReactNode, useContext, useMemo } from "react";
import { PresenceContext } from "../providers/presence-context";
import type { PresenceUser } from "../types/presence";
import { cx, sortPresenceUsers } from "./internal-utils";
import { PresenceAvatar, type PresenceAvatarSize } from "./presence-avatar";

export interface PresenceBarProps {
  readonly users?: ReadonlyArray<PresenceUser>;
  readonly maxVisible?: number;
  readonly size?: PresenceAvatarSize;
  readonly includeOffline?: boolean;
  readonly emptyLabel?: string;
  readonly className?: string;
  readonly "aria-label"?: string;
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
}: PresenceBarProps): ReactNode => {
  const context = useContext(PresenceContext);

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

  return (
    <ul
      aria-label={ariaLabel}
      className={cx("awareness-presence-bar", className)}
    >
      {shownUsers.length > 0 ? (
        shownUsers.map((user) => (
          <li className="awareness-presence-bar__item" key={user.userId}>
            <PresenceAvatar size={size} user={user} />
          </li>
        ))
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
