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

const SECOND_MS = 1_000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * Format an absolute timestamp as a short relative phrase ("3m ago",
 * "just now"). Bounds at ~30s for "just now" so it doesn't tick visibly
 * while the user reads it.
 *
 * Uses `Math.floor` so each bucket transitions cleanly:
 * 59m → 1h, never 30m → 60m. Rounding would let a value display its
 * "rounded-up" form while still inside the smaller bucket, which feels
 * jumpy at boundaries.
 */
export const formatRelativeTime = (
  timestamp: number,
  now: number = Date.now(),
): string => {
  const elapsed = Math.max(0, now - timestamp);
  if (elapsed < 30 * SECOND_MS) return "just now";
  if (elapsed < MINUTE_MS) return `${Math.floor(elapsed / SECOND_MS)}s ago`;
  if (elapsed < HOUR_MS) return `${Math.floor(elapsed / MINUTE_MS)}m ago`;
  if (elapsed < DAY_MS) return `${Math.floor(elapsed / HOUR_MS)}h ago`;
  return `${Math.floor(elapsed / DAY_MS)}d ago`;
};

/**
 * Human-readable status sentence for a user, e.g. "Active now",
 * "Idle for 4m", "Offline 2h ago". Used by tooltips and screen-reader
 * descriptions.
 */
export const formatPresenceSummary = (
  user: PresenceUser,
  now: number = Date.now(),
): string => {
  const relative = formatRelativeTime(user.lastActiveAt, now);
  switch (user.status) {
    case "active":
      return user.meta?.isTyping === true ? "Typing now" : "Active now";
    case "idle":
      return `Idle · last active ${relative}`;
    case "offline":
      return `Offline · last seen ${relative}`;
    default:
      return relative;
  }
};
