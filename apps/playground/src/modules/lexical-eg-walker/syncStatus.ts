import type { AdapterConnectionState } from "@softmaple/awareness";
import type { TransportConnectionState } from "./persistence/channel";

export type PersistenceDisplayState =
  | "loading"
  | "pending"
  | "saved"
  | "unsaved";

export type SyncStatusTone = "default" | "warn" | "danger";

export interface SyncStatusView {
  readonly label: string;
  readonly tone: SyncStatusTone;
}

const CONNECTION_RANK = {
  error: 0,
  disconnected: 1,
  reconnecting: 2,
  connecting: 3,
  connected: 4,
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

const offlineLabel = (pendingCount: number): string =>
  pendingCount > 0
    ? `Offline · ${pendingCount} change${pendingCount === 1 ? "" : "s"} waiting`
    : "Offline · changes saved locally";

/**
 * Product-facing sync copy. Distinguishes remote sync from local durability.
 */
export const syncStatusView = ({
  connectionState,
  persistenceState,
  pendingCount,
  transportMode = "broadcast",
}: {
  readonly connectionState: AdapterConnectionState;
  readonly persistenceState: PersistenceDisplayState;
  readonly pendingCount: number;
  readonly transportMode?: "websocket" | "broadcast";
}): SyncStatusView => {
  if (connectionState === "error") {
    return { label: "Unable to sync this room", tone: "danger" };
  }

  if (persistenceState === "unsaved") {
    return { label: "Changes are only stored in memory", tone: "danger" };
  }

  if (connectionState === "reconnecting") {
    return { label: "Reconnecting…", tone: "warn" };
  }

  if (connectionState === "connecting") {
    return { label: "Connecting…", tone: "warn" };
  }

  if (connectionState === "disconnected") {
    if (transportMode === "websocket") {
      return { label: offlineLabel(pendingCount), tone: "danger" };
    }
    return { label: "Working in this tab", tone: "warn" };
  }

  if (persistenceState === "loading") {
    return { label: "Recovering missing changes…", tone: "warn" };
  }

  if (persistenceState === "pending" || pendingCount > 0) {
    return { label: "Saving changes…", tone: "warn" };
  }

  return { label: "Synced", tone: "default" };
};

/** @deprecated Prefer syncStatusView — kept for diagnostics detail rows. */
export const persistenceLabel = (
  state: PersistenceDisplayState,
  pendingCount: number,
): string => {
  switch (state) {
    case "loading":
      return "Recovering missing changes…";
    case "pending":
      return `${pendingCount} change${pendingCount === 1 ? "" : "s"} pending`;
    case "saved":
      return "Durable on this device";
    case "unsaved":
      return "Changes are only stored in memory";
  }
};

export const connectionDetailLabel = (
  state: AdapterConnectionState,
): string => {
  switch (state) {
    case "connected":
      return "Connected";
    case "connecting":
      return "Connecting";
    case "reconnecting":
      return "Reconnecting";
    case "error":
      return "Error";
    case "disconnected":
      return "Disconnected";
  }
};
