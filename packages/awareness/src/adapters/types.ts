/**
 * Transport-agnostic adapter interface for presence systems
 * Adapters handle the communication layer (WebSocket, BroadcastChannel, etc.)
 */

import type { PresenceEvent, PresenceEventPayload } from "../types/events";
import type { PresenceUser, PresenceUserPatch } from "../types/presence";

/**
 * Adapter connection state.
 *
 * Ready handshake (WebSocket):
 *   disconnected → connecting → authenticating → syncing → connected
 *
 * `connect()` resolves only when state reaches `connected` (presence ready),
 * not merely when the socket opens.
 */
export type AdapterConnectionState =
  | "disconnected"
  | "connecting"
  | "authenticating"
  | "syncing"
  | "connected"
  | "reconnecting"
  | "error";

/**
 * Configuration for creating an adapter
 */
export interface AdapterConfig {
  /** Room/channel identifier */
  readonly roomId: string;
  /** Local user information */
  readonly userInfo: AdapterUserInfo;
  /** Optional reconnection settings */
  readonly reconnect?: ReconnectConfig;
}

/**
 * User info provided to adapter
 */
export interface AdapterUserInfo {
  readonly userId: string;
  readonly name: string;
  readonly avatarUrl?: string;
  readonly color: string;
}

/**
 * Reconnection configuration
 */
export interface ReconnectConfig {
  /** Whether to auto-reconnect on disconnect */
  readonly enabled: boolean;
  /** Maximum reconnection attempts */
  readonly maxAttempts: number;
  /** Base delay between attempts in ms */
  readonly baseDelayMs: number;
  /** Maximum delay between attempts in ms */
  readonly maxDelayMs: number;
}

/**
 * Default reconnection config
 */
export const DEFAULT_RECONNECT_CONFIG: ReconnectConfig = {
  enabled: true,
  maxAttempts: 5,
  baseDelayMs: 1000,
  maxDelayMs: 30_000,
} as const;

/**
 * Callback types for adapter events
 */
export type PresenceCallback = (
  users: ReadonlyMap<string, PresenceUser>,
) => void;
export type EventCallback = (event: PresenceEvent) => void;
export type ConnectionCallback = (state: AdapterConnectionState) => void;
export type ErrorCallback = (error: Error) => void;

/**
 * Unsubscribe function returned by subscribe methods
 */
export type Unsubscribe = () => void;

/**
 * Transport-agnostic adapter interface
 * Implementations: WebSocketAdapter, BroadcastChannelAdapter, SupabaseAdapter
 */
export interface PresenceAdapter {
  /**
   * Connect to the presence channel
   * @returns Promise that resolves when connected
   */
  connect(): Promise<void>;

  /**
   * Disconnect from the presence channel
   * @returns Promise that resolves when disconnected
   */
  disconnect(): Promise<void>;

  /**
   * Get current connection state
   */
  getConnectionState(): AdapterConnectionState;

  /**
   * Update local user's presence (marks activity + bumps clock)
   * @param updates Partial presence data to update
   */
  updatePresence(updates: PresenceUserPatch): void;

  /**
   * Broadcast an event to all users in the room
   * @param payload Event payload to broadcast
   */
  broadcast(payload: PresenceEventPayload): void;

  /**
   * Subscribe to presence updates
   * @param callback Called when presence state changes
   * @returns Unsubscribe function
   */
  onPresenceChange(callback: PresenceCallback): Unsubscribe;

  /**
   * Subscribe to presence events
   * @param callback Called when an event is received
   * @returns Unsubscribe function
   */
  onEvent(callback: EventCallback): Unsubscribe;

  /**
   * Subscribe to connection state changes
   * @param callback Called when connection state changes
   * @returns Unsubscribe function
   */
  onConnectionChange(callback: ConnectionCallback): Unsubscribe;

  /**
   * Subscribe to errors
   * @param callback Called when an error occurs
   * @returns Unsubscribe function
   */
  onError(callback: ErrorCallback): Unsubscribe;

  /**
   * Get current presence state (all users)
   */
  getPresence(): ReadonlyMap<string, PresenceUser>;

  /**
   * Get local user's presence
   */
  getSelf(): PresenceUser | null;
}

/**
 * Factory function type for creating adapters
 */
export type AdapterFactory = (config: AdapterConfig) => PresenceAdapter;
