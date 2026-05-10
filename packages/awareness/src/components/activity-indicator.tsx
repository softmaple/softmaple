import { type ReactNode, useContext, useMemo } from "react";
import { ACTIVITY_TYPE } from "../constants/presence-events";
import { PresenceContext } from "../providers/presence-context";
import type { ActivityEvent } from "../types/events";
import type { PresenceUser } from "../types/presence";
import { cx } from "./utils";

export interface ActivityIndicatorProps {
  readonly activities?: ReadonlyArray<ActivityEvent>;
  readonly users?: ReadonlyMap<string, PresenceUser>;
  readonly maxItems?: number;
  readonly emptyLabel?: string;
  readonly className?: string;
  readonly "aria-label"?: string;
}

const getActivityText = (
  activity: ActivityEvent,
  users: ReadonlyMap<string, PresenceUser>,
): string => {
  const name = users.get(activity.userId)?.name ?? "Someone";

  switch (activity.type) {
    case ACTIVITY_TYPE.JOIN:
      return `${name} joined`;
    case ACTIVITY_TYPE.LEAVE:
      return `${name} left`;
    case ACTIVITY_TYPE.CURSOR:
      return `${name} moved cursor`;
    case ACTIVITY_TYPE.SELECTION:
      return `${name} selected text`;
    case ACTIVITY_TYPE.TYPING:
      return `${name} is typing`;
    case ACTIVITY_TYPE.IDLE:
      return `${name} is idle`;
    default:
      return `${name} updated`;
  }
};

export const ActivityIndicator = ({
  activities,
  users,
  maxItems = 3,
  emptyLabel = "No recent activity",
  className,
  "aria-label": ariaLabel = "Recent collaboration activity",
}: ActivityIndicatorProps): ReactNode => {
  const context = useContext(PresenceContext);

  const renderedActivities = activities ?? context?.recentActivity ?? [];
  const usersById =
    users ?? context?.presence ?? new Map<string, PresenceUser>();

  const items = useMemo(
    () =>
      renderedActivities.slice(0, maxItems).map((activity) => ({
        activity,
        text: getActivityText(activity, usersById),
      })),
    [maxItems, renderedActivities, usersById],
  );

  return (
    <div
      aria-label={ariaLabel}
      aria-live="polite"
      className={cx("awareness-activity-indicator", className)}
      role="log"
    >
      {items.length > 0 ? (
        <ol className="awareness-activity-indicator__list">
          {items.map(({ activity, text }) => (
            <li
              className={cx(
                "awareness-activity-indicator__item",
                `awareness-activity-indicator__item--${activity.type}`,
              )}
              key={`${activity.userId}-${activity.timestamp}-${activity.type}`}
            >
              <span
                aria-hidden="true"
                className="awareness-activity-indicator__glyph"
              />
              <span className="awareness-activity-indicator__text">{text}</span>
            </li>
          ))}
        </ol>
      ) : (
        <span className="awareness-activity-indicator__empty">
          {emptyLabel}
        </span>
      )}
    </div>
  );
};
