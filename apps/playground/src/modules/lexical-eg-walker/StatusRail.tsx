import type {
  AdapterConnectionState,
  PresenceUser,
} from "@softmaple/awareness";
import {
  Check,
  CloudOff,
  Copy,
  Database,
  LoaderCircle,
  Radio,
  WifiOff,
} from "lucide-react";
import type { ReactNode } from "react";
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

export interface StatusRailProps {
  readonly roomId: string;
  readonly connectionState: AdapterConnectionState;
  readonly transportMode?: "websocket" | "broadcast";
  readonly persistenceState: PersistenceDisplayState;
  readonly pendingCount: number;
  readonly storageBytes: number;
  readonly users: ReadonlyArray<PresenceUser>;
  readonly onCopyRoomLink: () => void;
}

const formatStorageSize = (bytes: number): string => {
  if (bytes < 1_024) return `${bytes} B`;
  return `${(bytes / 1_024).toFixed(1)} KB`;
};

const persistenceLabel = (
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

const connectionLabel = (
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

const isReconnectWarningState = (state: AdapterConnectionState): boolean =>
  state === "disconnected" || state === "reconnecting" || state === "error";

const StatusItem = ({
  icon,
  children,
  tone = "default",
}: {
  icon: ReactNode;
  children: ReactNode;
  tone?: "default" | "warn" | "danger";
}) => {
  const toneClass =
    tone === "danger"
      ? "text-rose-700"
      : tone === "warn"
        ? "text-amber-700"
        : "text-[var(--pg-ink-muted)]";
  const iconClass =
    tone === "danger"
      ? "text-rose-500"
      : tone === "warn"
        ? "text-amber-500"
        : "text-[var(--pg-accent)]";

  return (
    <span
      className={`inline-flex min-w-0 items-center gap-1.5 whitespace-nowrap ${toneClass}`}
    >
      <span aria-hidden className={iconClass}>
        {icon}
      </span>
      <span className="truncate">{children}</span>
    </span>
  );
};

export function StatusRail({
  roomId,
  connectionState,
  transportMode = "broadcast",
  persistenceState,
  pendingCount,
  storageBytes,
  users,
  onCopyRoomLink,
}: StatusRailProps) {
  const persistenceIcon =
    persistenceState === "saved" ? (
      <Check className="size-3.5" />
    ) : persistenceState === "unsaved" ? (
      <CloudOff className="size-3.5 text-rose-500" />
    ) : (
      <LoaderCircle className="size-3.5 motion-safe:animate-spin" />
    );

  const connectionTone =
    connectionState === "error" || connectionState === "disconnected"
      ? "danger"
      : connectionState === "reconnecting" || connectionState === "connecting"
        ? "warn"
        : "default";

  const connectionIcon =
    connectionState === "error" || connectionState === "disconnected" ? (
      <WifiOff className="size-3.5" />
    ) : connectionState === "reconnecting" ||
      connectionState === "connecting" ? (
      <LoaderCircle className="size-3.5 motion-safe:animate-spin" />
    ) : (
      <Radio className="size-3.5" />
    );

  return (
    // biome-ignore lint/a11y/useSemanticElements: transport status live region; <output> is for form-calculated values.
    <div
      className="relative z-20 flex min-h-10 flex-wrap items-center gap-x-4 gap-y-2 border-b border-[var(--pg-line)] bg-[var(--pg-surface)]/92 px-3 py-2 font-[family-name:var(--font-mono)] text-[11px] font-medium tracking-[0.02em] text-[var(--pg-ink-muted)] backdrop-blur md:px-5"
      data-testid="collaboration-status"
      data-transport={transportMode}
      data-connection-state={connectionState}
      role="status"
      aria-live="polite"
    >
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-[3px] bg-gradient-to-b from-[var(--pg-accent)] via-teal-500 to-orange-500"
      />
      <button
        type="button"
        className="group inline-flex max-w-48 items-center gap-1.5 px-1.5 py-1 text-[var(--pg-ink)] outline-none transition-colors hover:bg-[var(--pg-paper)] focus-visible:ring-2 focus-visible:ring-[var(--pg-accent)]"
        onClick={onCopyRoomLink}
        aria-label={`Copy link for room ${roomId}`}
      >
        <span className="truncate font-mono">room/{roomId}</span>
        <Copy className="size-3 opacity-50 transition-opacity group-hover:opacity-100" />
      </button>

      <StatusItem icon={connectionIcon} tone={connectionTone}>
        {connectionLabel(connectionState, transportMode)}
      </StatusItem>
      {isReconnectWarningState(connectionState) &&
      transportMode === "websocket" ? (
        <span className="border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
          Sync paused until reconnect
        </span>
      ) : null}
      <StatusItem icon={persistenceIcon}>
        {persistenceLabel(persistenceState, pendingCount)}
      </StatusItem>
      <StatusItem icon={<Database className="size-3.5" />}>
        {formatStorageSize(storageBytes)}
      </StatusItem>

      <div className="ml-auto flex items-center pl-1">
        {users.slice(0, 5).map((user, index) => (
          <span
            key={user.userId}
            className="grid size-6 place-items-center border-2 border-[var(--pg-surface)] text-[9px] font-bold text-white shadow-sm"
            style={{
              backgroundColor: user.color,
              marginLeft: index === 0 ? 0 : -5,
            }}
            title={user.name}
          >
            {user.name.slice(0, 2).toUpperCase()}
          </span>
        ))}
        <span className="ml-2 whitespace-nowrap text-[var(--pg-ink-muted)]">
          {users.length} online
        </span>
      </div>
    </div>
  );
}

export { formatStorageSize, persistenceLabel };
