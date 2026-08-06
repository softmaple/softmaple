import type { AdapterConnectionState } from "@softmaple/awareness";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@softmaple/ui/components/sheet";
import { toast } from "sonner";
import { clearRoomLocalData, copyText } from "./roomLink";
import {
  connectionDetailLabel,
  formatStorageSize,
  type PersistenceDisplayState,
  persistenceLabel,
} from "./syncStatus";

export interface DiagnosticsSheetProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly roomId: string;
  readonly replicaId: string;
  readonly connectionState: AdapterConnectionState;
  readonly presenceState: AdapterConnectionState;
  readonly documentSyncState: AdapterConnectionState | null;
  readonly transportMode: "websocket" | "broadcast";
  readonly persistenceState: PersistenceDisplayState;
  readonly pendingCount: number;
  readonly storageBytes: number;
}

const DetailRow = ({ label, value }: { label: string; value: string }) => (
  <div className="flex items-baseline justify-between gap-4 py-1.5">
    <dt className="text-[var(--pg-ink-muted)]">{label}</dt>
    <dd className="text-right font-[family-name:var(--font-mono)] text-[var(--pg-ink)]">
      {value}
    </dd>
  </div>
);

export function DiagnosticsSheet({
  open,
  onOpenChange,
  roomId,
  replicaId,
  connectionState,
  presenceState,
  documentSyncState,
  transportMode,
  persistenceState,
  pendingCount,
  storageBytes,
}: DiagnosticsSheetProps) {
  const transportLabel =
    transportMode === "websocket" ? "WebSocket" : "BroadcastChannel";

  const copyDebugReport = async () => {
    const report = [
      "SoftMaple Lexical diagnostics",
      `room: ${roomId}`,
      `replica: ${replicaId}`,
      `transport: ${transportLabel}`,
      `connection: ${connectionState}`,
      `presence: ${presenceState}`,
      `documentSync: ${documentSyncState ?? "n/a"}`,
      `persistence: ${persistenceState}`,
      `pendingBatches: ${pendingCount}`,
      `localStorage: ${formatStorageSize(storageBytes)}`,
      `protocol: v1`,
      `url: ${window.location.href}`,
    ].join("\n");
    const copied = await copyText(report);
    if (copied) {
      toast.success("Debug report copied");
    } else {
      toast.error("Failed to copy debug report");
    }
  };

  const clearLocal = () => {
    const removed = clearRoomLocalData(roomId);
    toast.success(
      removed > 0 ? "Local data cleared" : "No local data for this room",
    );
    window.location.reload();
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full border-[var(--pg-line)] bg-[var(--pg-paper)] text-[var(--pg-ink)] sm:max-w-md"
        data-testid="diagnostics-sheet"
      >
        <SheetHeader className="border-b border-[var(--pg-line)]">
          <SheetTitle className="font-[family-name:var(--font-display)] tracking-[-0.02em]">
            Diagnostics
          </SheetTitle>
          <SheetDescription className="text-[var(--pg-ink-muted)]">
            Transport, pending events, and local durability for this room.
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-1 flex-col gap-6 overflow-y-auto px-4 py-5 text-sm">
          <section>
            <h3 className="mb-2 font-[family-name:var(--font-mono)] text-[10px] font-semibold tracking-[0.16em] text-[var(--pg-ink-muted)] uppercase">
              Connection
            </h3>
            <dl className="border-y border-[var(--pg-line)]">
              <DetailRow
                label="Document sync"
                value={connectionDetailLabel(
                  documentSyncState ?? connectionState,
                )}
              />
              <DetailRow
                label="Presence"
                value={connectionDetailLabel(presenceState)}
              />
              <DetailRow label="Transport" value={transportLabel} />
              <DetailRow
                label="Merged state"
                value={connectionDetailLabel(connectionState)}
              />
            </dl>
          </section>

          <section>
            <h3 className="mb-2 font-[family-name:var(--font-mono)] text-[10px] font-semibold tracking-[0.16em] text-[var(--pg-ink-muted)] uppercase">
              Local state
            </h3>
            <dl className="border-y border-[var(--pg-line)]">
              <DetailRow label="Pending batches" value={String(pendingCount)} />
              <DetailRow
                label="Local storage"
                value={formatStorageSize(storageBytes)}
              />
              <DetailRow label="Replica ID" value={replicaId.slice(0, 12)} />
              <DetailRow label="Room" value={roomId} />
              <DetailRow
                label="Durability"
                value={persistenceLabel(persistenceState, pendingCount)}
              />
              <DetailRow label="Protocol" value="v1 · EG-walker × Lexical" />
            </dl>
          </section>

          <section>
            <h3 className="mb-2 font-[family-name:var(--font-mono)] text-[10px] font-semibold tracking-[0.16em] text-[var(--pg-ink-muted)] uppercase">
              Actions
            </h3>
            <div className="flex flex-col gap-2">
              <button
                type="button"
                className="border border-[var(--pg-line)] bg-[var(--pg-surface)] px-3 py-2 text-left text-sm font-semibold outline-none transition-colors hover:border-[var(--pg-ink)] focus-visible:ring-2 focus-visible:ring-[var(--pg-accent)]"
                onClick={() => {
                  void copyDebugReport();
                }}
                data-testid="diagnostics-copy-report"
              >
                Copy debug report
              </button>
              <button
                type="button"
                className="border border-rose-200 bg-rose-50 px-3 py-2 text-left text-sm font-semibold text-rose-800 outline-none transition-colors hover:border-rose-400 focus-visible:ring-2 focus-visible:ring-rose-400"
                onClick={clearLocal}
                data-testid="diagnostics-clear-local"
              >
                Clear local data
              </button>
            </div>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
