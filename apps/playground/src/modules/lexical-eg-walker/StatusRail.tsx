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
} from "lucide-react";
import type { ReactNode } from "react";

export type PersistenceDisplayState =
  | "loading"
  | "pending"
  | "saved"
  | "unsaved";

export interface StatusRailProps {
  readonly roomId: string;
  readonly connectionState: AdapterConnectionState;
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

const connectionLabel = (state: AdapterConnectionState): string => {
  switch (state) {
    case "connected":
      return "Tabs connected";
    case "connecting":
    case "reconnecting":
      return "Connecting tabs";
    case "error":
      return "Tab channel unavailable";
    case "disconnected":
      return "Working in this tab";
  }
};

const StatusItem = ({
  icon,
  children,
}: {
  icon: ReactNode;
  children: ReactNode;
}) => (
  <span className="inline-flex min-w-0 items-center gap-1.5 whitespace-nowrap">
    <span aria-hidden className="text-[#475BD8]">
      {icon}
    </span>
    <span className="truncate">{children}</span>
  </span>
);

export function StatusRail({
  roomId,
  connectionState,
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
      <CloudOff className="size-3.5 text-[#E45D6F]" />
    ) : (
      <LoaderCircle className="size-3.5 motion-safe:animate-spin" />
    );

  return (
    <div
      className="relative z-20 flex min-h-10 flex-wrap items-center gap-x-4 gap-y-2 border-b border-[#CBD6E2] bg-white/92 px-3 py-2 text-[11px] font-medium tracking-[0.02em] text-[#526078] backdrop-blur md:px-5"
      data-testid="collaboration-status"
    >
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-[3px] bg-gradient-to-b from-[#475BD8] via-[#38BDF8] to-[#FF6B6B]"
      />
      <button
        type="button"
        className="group inline-flex max-w-48 items-center gap-1.5 rounded-md px-1.5 py-1 text-[#17253D] outline-none transition-colors hover:bg-[#EEF3F7] focus-visible:ring-2 focus-visible:ring-[#475BD8]"
        onClick={onCopyRoomLink}
        aria-label={`Copy link for room ${roomId}`}
      >
        <span className="truncate font-mono">room/{roomId}</span>
        <Copy className="size-3 opacity-50 transition-opacity group-hover:opacity-100" />
      </button>

      <StatusItem icon={<Radio className="size-3.5" />}>
        {connectionLabel(connectionState)}
      </StatusItem>
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
            className="grid size-6 place-items-center rounded-full border-2 border-white text-[9px] font-bold text-white shadow-sm"
            style={{
              backgroundColor: user.color,
              marginLeft: index === 0 ? 0 : -5,
            }}
            title={user.name}
          >
            {user.name.slice(0, 2).toUpperCase()}
          </span>
        ))}
        {users.length > 5 ? (
          <span className="-ml-[5px] grid size-6 place-items-center rounded-full border-2 border-white bg-[#526078] text-[9px] font-bold text-white shadow-sm">
            +{users.length - 5}
          </span>
        ) : null}
        <span className="ml-2 whitespace-nowrap text-[#526078]">
          {users.length} online
        </span>
      </div>
    </div>
  );
}

export { formatStorageSize, persistenceLabel };
