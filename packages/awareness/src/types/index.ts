/**
 * Awareness and Presence Types
 * Based on docs/design/awareness-and-presence.md
 */

export type PresenceStatus = "active" | "idle" | "offline";

export interface PresenceUser {
  userId: string;
  name: string;
  avatarUrl?: string;
  color: string;

  status: PresenceStatus;
  lastActiveAt: number;

  cursor?: {
    blockId?: string;
    offset?: number;
  };

  selection?: {
    blockId: string;
    from: number;
    to: number;
  };

  meta?: {
    isTyping?: boolean;
  };
}

export interface ActivityEvent {
  userId: string;
  timestamp: number;
  type: "edit" | "join" | "leave" | "cursor" | "selection";
  data?: unknown;
}

export interface PresenceState {
  users: Map<string, PresenceUser>;
  activities: ActivityEvent[];
}
