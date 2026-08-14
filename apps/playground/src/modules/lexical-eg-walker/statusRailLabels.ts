import type { AdapterConnectionState } from "@softmaple/awareness";
import type { TransportConnectionState } from "./persistence/channel";

export type PersistenceDisplayState =
  | "loading"
  | "pending"
  | "saved"
  | "unsaved";

const CONNECTION_RANK = {
  error: 0,
  disconnected: 1,
  reconnecting: 2,
  connecting: 3,
  authenticating: 4,
  syncing: 5,
  connected: 6,
} as const satisfies Record<AdapterConnectionState, number>;

/** Prefer the more degraded of presence + document sync states. */
export const mergeConnectionStates = (
  presence: AdapterConnectionState,
  sync: TransportConnectionState | null | undefined,
): AdapterConnectionState => {
  if (sync == null) return presence;
  return CONNECTION_RANK[presence] <= CONNECTION_RANK[sync] ? presence : sync;
};

export const formatStorageSize = (bytes: number): string => {
  if (bytes < 1_024) return `${bytes} B`;
  return `${(bytes / 1_024).toFixed(1)} KB`;
};

export const persistenceLabel = (
  state: PersistenceDisplayState,
  pendingCount: number,
): string => {
  switch (state) {
    case "loading":
      return "Loading local history";
    case "pending":
      return `${pendingCount} change${pendingCount === 1 ? "" : "s"} pending`;
    case "saved":
      return "Saved on this device";
    case "unsaved":
      return "Unsaved · memory only";
  }
};

export const connectionLabel = (
  state: AdapterConnectionState,
  transportMode: "websocket" | "broadcast" = "broadcast",
): string => {
  const channel =
    transportMode === "websocket" ? "WebSocket" : "BroadcastChannel";
  switch (state) {
    case "connected":
      return transportMode === "websocket"
        ? "WebSocket connected"
        : "Tabs connected";
    case "connecting":
      return `Connecting via ${channel}…`;
    case "authenticating":
      return `Authenticating via ${channel}…`;
    case "syncing":
      return `Syncing presence via ${channel}…`;
    case "reconnecting":
      return `Reconnecting via ${channel}…`;
    case "error":
      return `${channel} unavailable — refresh to retry`;
    case "disconnected":
      return transportMode === "websocket"
        ? "WebSocket offline"
        : "Working in this tab";
  }
};

export const isReconnectWarningState = (
  state: AdapterConnectionState,
): boolean =>
  state === "disconnected" || state === "reconnecting" || state === "error";
