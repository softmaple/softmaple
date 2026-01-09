/**
 * @softmaple/awareness - Awareness and presence UI components
 * for real-time collaboration
 */

export { createBroadcastChannelAdapter } from "./adapters/broadcast-channel";
export * from "./adapters/types";
export { createWebSocketAdapter } from "./adapters/websocket";
export { useConnectionState, useIsConnected } from "./hooks/use-connection";
export {
  useOther,
  useOthers,
  useOthersCount,
  useOthersFiltered,
} from "./hooks/use-others";
export { usePresence } from "./hooks/use-presence";
export { useSelf } from "./hooks/use-self";
export {
  useUpdateCursor,
  useUpdatePresence,
  useUpdateSelection,
} from "./hooks/use-update-presence";
export type { PresenceContextValue } from "./providers/presence-context";
export { PresenceContext } from "./providers/presence-context";
export type { PresenceProviderProps } from "./providers/presence-provider";
export { PresenceProvider } from "./providers/presence-provider";
export * from "./types/events";
export * from "./types/presence";
export * from "./types/state";
