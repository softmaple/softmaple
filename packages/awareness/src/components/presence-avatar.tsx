import { type CSSProperties, type ReactNode, useState } from "react";
import type { PresenceUser } from "../types/presence";
import { cx, getInitials, toUserColorStyle } from "./internal-utils";

export type PresenceAvatarSize = "sm" | "md" | "lg";

export interface PresenceAvatarProps {
  readonly user: PresenceUser;
  readonly size?: PresenceAvatarSize;
  readonly showStatus?: boolean;
  readonly className?: string;
  readonly style?: CSSProperties;
}

const statusLabel = (user: PresenceUser): string =>
  `${user.name}, ${user.status}`;

export const PresenceAvatar = ({
  user,
  size = "md",
  showStatus = true,
  className,
  style,
}: PresenceAvatarProps): ReactNode => {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  return (
    <span
      aria-label={statusLabel(user)}
      className={cx(
        "awareness-avatar",
        `awareness-avatar--${size}`,
        `awareness-avatar--${user.status}`,
        className,
      )}
      role="img"
      style={{ ...toUserColorStyle(user.color), ...style }}
      title={statusLabel(user)}
    >
      {user.avatarUrl && user.avatarUrl !== failedUrl ? (
        <img
          alt=""
          className="awareness-avatar__image"
          src={user.avatarUrl}
          onError={() => setFailedUrl(user.avatarUrl ?? null)}
        />
      ) : (
        <span aria-hidden="true" className="awareness-avatar__initials">
          {getInitials(user.name)}
        </span>
      )}
      {showStatus ? (
        <span aria-hidden="true" className="awareness-avatar__status" />
      ) : null}
    </span>
  );
};
