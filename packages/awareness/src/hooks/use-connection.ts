/**
 * useConnection hook - Access connection state
 */

import { useContext } from "react";
import type { AdapterConnectionState } from "../adapters/types";
import { PresenceContext } from "../providers/presence-context";

const PROVIDER_ERROR_MSG =
  "must be used within a PresenceProvider. " +
  "Wrap your component tree with <PresenceProvider adapter={adapter}>.";

/**
 * Hook to access the connection state
 * @returns The current connection state
 * @throws Error if used outside of PresenceProvider
 */
export const useConnectionState = (): AdapterConnectionState => {
  const context = useContext(PresenceContext);
  if (!context) {
    throw new Error(`useConnectionState ${PROVIDER_ERROR_MSG}`);
  }
  return context.connectionState;
};

/**
 * Hook to check if currently connected
 * @returns true if connected, false otherwise
 * @throws Error if used outside of PresenceProvider
 */
export const useIsConnected = (): boolean => {
  const context = useContext(PresenceContext);
  if (!context) {
    throw new Error(`useIsConnected ${PROVIDER_ERROR_MSG}`);
  }
  return context.connectionState === "connected";
};
