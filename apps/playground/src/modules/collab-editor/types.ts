export interface Room {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  createdBy?: string;
}

// Re-import and re-export graph types from eg-walker.
import type {
  GraphEvent as EgWalkerGraphEvent,
  EventId,
  SerializedGraphEventOutput,
} from "@softmaple/eg-walker";
export type GraphEvent = EgWalkerGraphEvent;
export type WireGraphEvent = SerializedGraphEventOutput;

export interface Document {
  roomId: string;
  content: string;
  /** Legacy event-count field; retained only for old IndexedDB rows. */
  version?: number;
  frontier: EventId[];
  events: WireGraphEvent[];
  lastModified: number; // Unix timestamp
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
  | { type: "event"; data: WireGraphEvent }
  | {
      type: "sync-request";
      data: { frontier: EventId[]; knownEventIds: EventId[] };
    }
  | {
      type: "sync-response";
      data: { frontier: EventId[]; events: WireGraphEvent[] };
    }
  | {
      type: "presence";
      data: { cursor?: number; selection?: { start: number; end: number } };
    };

export type SyncMessage = {
  roomId: string;
  userId: string;
  timestamp: number;
} & SyncMessageData;
