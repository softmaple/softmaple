export interface Room {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
}

export interface Document {
  roomId: string;
  content: string;
  version: number;
  events: any[]; // eg-walker events
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

export interface SyncMessage {
  type: 'join' | 'leave' | 'event' | 'sync-request' | 'sync-response' | 'presence';
  roomId: string;
  userId: string;
  data?: any;
  timestamp: number;
}
