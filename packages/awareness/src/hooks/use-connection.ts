/**
 * useConnection hook - Access connection state
 */

import { useContext } from "react";
import type { AdapterConnectionState } from "../adapters/types";
import { PresenceContext } from "../providers/presence-context";

/**
 * Hook to access the connection state
 * @returns The current connection state
 */
export const useConnectionState = (): AdapterConnectionState => {
  const { connectionState } = useContext(PresenceContext);
  return connectionState;
};

/**
 * Hook to check if currently connected
 * @returns true if connected, false otherwise
 */
export const useIsConnected = (): boolean => {
  const { connectionState } = useContext(PresenceContext);
  return connectionState === "connected";
};
