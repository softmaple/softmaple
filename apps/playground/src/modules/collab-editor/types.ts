export interface Room {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  createdBy?: string;
}

// Re-import and re-export GraphEvent from eg-walker
import type { GraphEvent as EgWalkerGraphEvent } from "@softmaple/eg-walker";
export type GraphEvent = EgWalkerGraphEvent;

export interface Document {
  roomId: string;
  content: string;
  version: number;
  events: GraphEvent[]; // eg-walker events
}

export interface User {
  id: string;
  name: string;
  color: string;
}

export interface Participant {
  userId: string;
  roomId: string;
  joinedAt: number;
  isActive: boolean;
}

// Different message data types based on message type
export type SyncMessageData =
  | { type: "join"; data: User }
  | { type: "leave"; data?: undefined }
  | { type: "event"; data: GraphEvent }
  | { type: "sync-request"; data: { version: number } }
  | { type: "sync-response"; data: { events: GraphEvent[]; version: number } }
  | {
      type: "presence";
      data: { cursor?: number; selection?: { start: number; end: number } };
    };

export type SyncMessage = {
  roomId: string;
  userId: string;
  timestamp: number;
} & SyncMessageData;
