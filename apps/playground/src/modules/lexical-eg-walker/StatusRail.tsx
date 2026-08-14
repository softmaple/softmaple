import type {
  AdapterConnectionState,
  PresenceUser,
} from "@softmaple/awareness";
import {
  Check,
  CloudOff,
  Database,
  LoaderCircle,
  Radio,
  WifiOff,
} from "lucide-react";
import type { ReactNode } from "react";
import { RoomCopyControl } from "./RoomCopyControl";
import {
  connectionLabel,
  formatStorageSize,
  isReconnectWarningState,
  type PersistenceDisplayState,
  persistenceLabel,
} from "./statusRailLabels";

export {
  formatStorageSize,
  mergeConnectionStates,
  type PersistenceDisplayState,
  persistenceLabel,
} from "./statusRailLabels";

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
      ? "text-rose-400"
      : tone === "warn"
        ? "text-amber-400"
        : "text-[var(--pg-ink-muted)]";
  const iconClass =
    tone === "danger"
      ? "text-rose-400"
      : tone === "warn"
        ? "text-amber-400"
        : "text-[var(--pg-accent)]";

  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap ${toneClass}`}
    >
      <span aria-hidden className={iconClass}>
        {icon}
      </span>
      <span>{children}</span>
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
      <CloudOff className="size-3.5 text-rose-400" />
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
      className="pg-status-rail relative z-20 min-w-0 flex-1 overflow-x-auto font-[family-name:var(--font-mono)] text-[11px] font-medium tracking-[0.02em] text-[var(--pg-ink-muted)]"
      data-testid="collaboration-status"
      data-transport={transportMode}
      data-connection-state={connectionState}
      role="status"
      aria-live="polite"
    >
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-[3px] bg-gradient-to-b from-[var(--pg-accent)] via-teal-400 to-orange-400"
      />
      <div className="flex min-h-12 min-w-max flex-1 items-center gap-3 px-3 md:gap-4 md:px-5">
        <RoomCopyControl roomId={roomId} onCopyRoomLink={onCopyRoomLink} />
        <span className="h-5 w-px shrink-0 bg-[var(--pg-line)]" aria-hidden />
        <StatusItem icon={connectionIcon} tone={connectionTone}>
          {connectionLabel(connectionState, transportMode)}
        </StatusItem>
        {isReconnectWarningState(connectionState) &&
        transportMode === "websocket" ? (
          <span className="border border-amber-400/25 bg-amber-400/10 px-2 py-0.5 text-[10px] font-semibold text-amber-300">
            Sync paused until reconnect
          </span>
        ) : null}
        <span className="h-5 w-px shrink-0 bg-[var(--pg-line)]" aria-hidden />
        <StatusItem icon={persistenceIcon}>
          {persistenceLabel(persistenceState, pendingCount)}
        </StatusItem>
        <StatusItem icon={<Database className="size-3.5" />}>
          {formatStorageSize(storageBytes)}
        </StatusItem>

        <div className="ml-auto hidden items-center pl-1 md:flex">
          {users.slice(0, 5).map((user, index) => (
            <span
              key={user.connectionId}
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
    </div>
  );
}
