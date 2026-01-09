/**
 * Export adapter interfaces and implementations
 */

// Adapter types
export type {
  AdapterConfig,
  AdapterConnectionState,
  AdapterFactory,
  AdapterUserInfo,
  ConnectionCallback,
  ErrorCallback,
  EventCallback,
  PresenceAdapter,
  PresenceCallback,
  ReconnectConfig,
  Unsubscribe,
} from "./types";

export { DEFAULT_RECONNECT_CONFIG } from "./types";

// Adapter implementations (to be added)
// export { BroadcastChannelAdapter } from "./broadcast";
// export { WebSocketAdapter } from "./websocket";
// export { SupabaseAdapter } from "./supabase";
