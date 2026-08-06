import type {
  AdapterConnectionState,
  PresenceUser,
} from "@softmaple/awareness";
import { Link } from "@tanstack/react-router";
import {
  LoaderCircle,
  MoreHorizontal,
  Radio,
  Share2,
  WifiOff,
} from "lucide-react";
import { useState } from "react";
import { DiagnosticsSheet } from "./DiagnosticsSheet";
import { ShareRoomDialog } from "./ShareRoomDialog";
import { type PersistenceDisplayState, syncStatusView } from "./syncStatus";

export type { PersistenceDisplayState } from "./syncStatus";
export {
  formatStorageSize,
  mergeConnectionStates,
  persistenceLabel,
  syncStatusView,
} from "./syncStatus";

export interface StatusRailProps {
  readonly roomId: string;
  readonly replicaId: string;
  readonly connectionState: AdapterConnectionState;
  readonly presenceState: AdapterConnectionState;
  readonly documentSyncState: AdapterConnectionState | null;
  readonly transportMode?: "websocket" | "broadcast";
  readonly persistenceState: PersistenceDisplayState;
  readonly pendingCount: number;
  readonly storageBytes: number;
  readonly users: ReadonlyArray<PresenceUser>;
  readonly shareOpen?: boolean;
  readonly onShareOpenChange?: (open: boolean) => void;
  readonly labOpen?: boolean;
  readonly onLabOpenChange?: (open: boolean) => void;
}

export function StatusRail({
  roomId,
  replicaId,
  connectionState,
  presenceState,
  documentSyncState,
  transportMode = "broadcast",
  persistenceState,
  pendingCount,
  storageBytes,
  users,
  shareOpen: shareOpenProp,
  onShareOpenChange,
  labOpen = false,
  onLabOpenChange,
}: StatusRailProps) {
  const [shareOpenUncontrolled, setShareOpenUncontrolled] = useState(false);
  const shareOpen = shareOpenProp ?? shareOpenUncontrolled;
  const setShareOpen = onShareOpenChange ?? setShareOpenUncontrolled;
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const status = syncStatusView({
    connectionState,
    persistenceState,
    pendingCount,
    transportMode,
  });

  const statusIcon =
    status.tone === "danger" ? (
      <WifiOff className="size-3.5" />
    ) : status.tone === "warn" ? (
      <LoaderCircle className="size-3.5 motion-safe:animate-spin" />
    ) : (
      <Radio className="size-3.5" />
    );

  const toneClass =
    status.tone === "danger"
      ? "text-rose-700"
      : status.tone === "warn"
        ? "text-amber-700"
        : "text-[var(--pg-ink)]";

  const peopleLabel =
    users.length === 1 ? "1 person online" : `${users.length} people online`;

  return (
    <>
      {/* biome-ignore lint/a11y/useSemanticElements: transport status live region; <output> is for form-calculated values. */}
      <div
        className="relative z-20 flex min-h-12 flex-wrap items-center gap-x-3 gap-y-2 border-b border-[var(--pg-line)] bg-[var(--pg-surface)]/94 px-3 py-2 backdrop-blur md:px-5"
        data-testid="collaboration-status"
        data-transport={transportMode}
        data-connection-state={connectionState}
        data-sync-label={status.label}
        role="status"
        aria-live="polite"
      >
        <Link
          to="/"
          className="inline-flex min-w-0 items-baseline gap-1.5 font-[family-name:var(--font-display)] text-sm font-bold tracking-[-0.03em] text-[var(--pg-ink)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--pg-accent)]"
        >
          SoftMaple
          <span className="truncate font-normal text-[var(--pg-ink-muted)]">
            / Lexical
          </span>
        </Link>

        <button
          type="button"
          className={`mx-auto inline-flex max-w-[min(100%,18rem)] items-center gap-1.5 px-2 py-1 font-[family-name:var(--font-mono)] text-[11px] font-medium outline-none transition-colors hover:bg-[var(--pg-paper)] focus-visible:ring-2 focus-visible:ring-[var(--pg-accent)] ${toneClass}`}
          onClick={() => setDiagnosticsOpen(true)}
          aria-label={`${status.label}. Open diagnostics.`}
          data-testid="sync-status-button"
        >
          <span aria-hidden className="text-[var(--pg-accent)]">
            {statusIcon}
          </span>
          <span className="truncate">{status.label}</span>
        </button>

        <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
          <div className="hidden items-center sm:flex">
            {users.slice(0, 5).map((user, index) => (
              <span
                key={user.userId}
                className="grid size-6 place-items-center border-2 border-[var(--pg-surface)] text-[9px] font-bold text-white"
                style={{
                  backgroundColor: user.color,
                  marginLeft: index === 0 ? 0 : -5,
                }}
                title={user.name}
              >
                {user.name.slice(0, 2).toUpperCase()}
              </span>
            ))}
            <span className="ml-2 whitespace-nowrap font-[family-name:var(--font-mono)] text-[11px] text-[var(--pg-ink-muted)]">
              {peopleLabel}
            </span>
          </div>
          <span className="font-[family-name:var(--font-mono)] text-[11px] text-[var(--pg-ink-muted)] sm:hidden">
            {users.length} online
          </span>

          <button
            type="button"
            className="inline-flex items-center gap-1.5 bg-[var(--pg-ink)] px-2.5 py-1.5 text-xs font-semibold text-[var(--pg-paper)] outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-[var(--pg-accent)]"
            onClick={() => setShareOpen(true)}
            data-testid="share-room-button"
          >
            <Share2 className="size-3.5" aria-hidden />
            Share
          </button>

          <button
            type="button"
            className="inline-flex size-8 items-center justify-center border border-[var(--pg-line)] bg-[var(--pg-surface)] text-[var(--pg-ink-muted)] outline-none transition-colors hover:border-[var(--pg-ink)] hover:text-[var(--pg-ink)] focus-visible:ring-2 focus-visible:ring-[var(--pg-accent)]"
            onClick={() => {
              if (onLabOpenChange) {
                onLabOpenChange(!labOpen);
              } else {
                setDiagnosticsOpen(true);
              }
            }}
            aria-label={labOpen ? "Hide Collaboration Lab" : "Diagnostics"}
            aria-pressed={labOpen}
            data-testid="diagnostics-menu-button"
          >
            <MoreHorizontal className="size-4" aria-hidden />
          </button>
        </div>
      </div>

      <ShareRoomDialog
        roomId={roomId}
        open={shareOpen}
        onOpenChange={setShareOpen}
      />
      <DiagnosticsSheet
        open={diagnosticsOpen}
        onOpenChange={setDiagnosticsOpen}
        roomId={roomId}
        replicaId={replicaId}
        connectionState={connectionState}
        presenceState={presenceState}
        documentSyncState={documentSyncState}
        transportMode={transportMode}
        persistenceState={persistenceState}
        pendingCount={pendingCount}
        storageBytes={storageBytes}
      />
    </>
  );
}
