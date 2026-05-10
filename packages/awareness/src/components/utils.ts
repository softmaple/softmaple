import type { CSSProperties } from "react";
import type { PresenceStatus, PresenceUser } from "../types/presence";

export const cx = (
  ...classes: ReadonlyArray<string | false | null | undefined>
): string => classes.filter(Boolean).join(" ");

export const getInitials = (name: string): string => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";

  const initials = parts
    .slice(0, 2)
    .map((part) => part.at(0)?.toUpperCase() ?? "")
    .join("");

  return initials || "?";
};

export const sortPresenceUsers = (
  users: ReadonlyArray<PresenceUser>,
): ReadonlyArray<PresenceUser> => {
  const statusRank: Record<PresenceStatus, number> = {
    active: 0,
    idle: 1,
    offline: 2,
  };

  return [...users].sort((a, b) => {
    const statusDelta = statusRank[a.status] - statusRank[b.status];
    if (statusDelta !== 0) return statusDelta;
    return b.lastActiveAt - a.lastActiveAt;
  });
};

export const toUserColorStyle = (
  color: string,
): CSSProperties & { "--awareness-user-color": string } => ({
  "--awareness-user-color": color,
});
