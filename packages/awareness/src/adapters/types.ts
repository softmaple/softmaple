/**
 * Transport-agnostic adapter interface for presence systems
 */

import type { PresenceUser, ActivityEvent } from "../types";

export interface PresenceAdapter {
  // Connection lifecycle
  connect(roomId: string, userId: string): Promise<void>;
  disconnect(): Promise<void>;

  // Presence operations
  updatePresence(data: Partial<PresenceUser>): void;
  subscribeToPresence(
    callback: (users: Map<string, PresenceUser>) => void,
  ): () => void;

  // Optional: Activity broadcast
  broadcastActivity?(activity: ActivityEvent): void;
  subscribeToActivities?(
    callback: (activity: ActivityEvent) => void,
  ): () => void;
}

export interface AdapterConfig {
  roomId: string;
  userId: string;
  userInfo: {
    name: string;
    avatarUrl?: string;
    color?: string;
  };
}
